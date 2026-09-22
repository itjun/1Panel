<template>
  <el-config-provider :locale="zhCn" size="default">
    <div class="app-shell">
      <div class="app-chrome is-term terminal-window-chrome">
        <WorkspaceRail terminal-only />
        <div class="main-column">
          <TerminalModule />
        </div>
      </div>
    </div>
  </el-config-provider>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from "vue";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import { Events, Window } from "@wailsio/runtime";
import { api, type main } from "@/api";
import TerminalModule from "@/layout/TerminalModule.vue";
import WorkspaceRail from "@/layout/WorkspaceRail.vue";
import { useAppStore } from "@/stores/app";
import { chromeDragKey, type ChromeDragApi } from "@/composables/useChromeDrag";
import { hostDragKey, useHostDrag } from "@/composables/useHostDrag";
import { isTermAppShortcut, isTermNewShortcut } from "@/utils/termKeys";

const app = useAppStore();
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const maximised = ref(false);

const chromeDragApi: ChromeDragApi = {
  openMenu: (e) => e.preventDefault(),
  toggleMaximise: async () => {
    await Window.ToggleMaximise();
    maximised.value = await Window.IsMaximised();
  },
  minimiseWin: () => {
    void Window.Minimise();
  },
  hideToBackground: () => {
    void Events.Emit("app-hide-to-background");
  },
  maximised,
  isMac,
  kbd: (key: string) => (isMac ? `⌘${key}` : `Ctrl+${key}`),
};
provide(chromeDragKey, chromeDragApi);
provide(hostDragKey, useHostDrag());

function waitForDeskRender() {
  return nextTick().then(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      })
  );
}

type TerminalDeskDrag = { sourceWindowId?: string; sourceDeskId?: string };

function readTerminalDeskDrag(e: DragEvent): TerminalDeskDrag | null {
  const raw = e.dataTransfer?.getData("application/x-terminal-desk") || "";
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw) as TerminalDeskDrag;
    return payload.sourceDeskId ? payload : null;
  } catch {
    return null;
  }
}

function onTerminalWindowDragOver(e: DragEvent) {
  if (!Array.from(e.dataTransfer?.types || []).includes("application/x-terminal-desk")) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
}

function onTerminalWindowDrop(e: DragEvent) {
  const payload = readTerminalDeskDrag(e);
  if (!payload || payload.sourceWindowId === app.windowId) return;
  e.preventDefault();
  void Events.Emit("terminal-window-drop", {
    sourceWindowId: payload.sourceWindowId || "",
    sourceDeskId: payload.sourceDeskId || "",
    targetWindowId: app.windowId,
  });
}

async function applyCommand(command: main.TerminalWindowCommand | null | undefined) {
  if (command?.windowId && command.windowId !== app.windowId) return;
  const action = (command?.action || "").trim();
  if (!action) return;

  // 先进入终端工作区；空窗口直接显示临时主机选择器。
  app.setWorkspace("terminal");

  if (action === "connect") {
    app.connectTerminal(command?.host || "");
    return;
  }
  if (action === "new") {
    app.openNewTerminalPicker();
    return;
  }
  if (action === "open-many") {
    for (const host of command?.hosts || []) {
      app.openAnotherTerminal(host);
    }
    return;
  }
  if (action === "merge") {
    const deskIds: string[] = [];
    for (const host of command?.hosts || []) {
      const id = app.openAnotherTerminal(host);
      if (id && !deskIds.includes(id)) deskIds.push(id);
    }
    const targetId = deskIds[0];
    if (!targetId) return;
    app.activateTerminalDesk(targetId);
    await waitForDeskRender();
    const jobs = deskIds.slice(1).flatMap((sourceId) => {
      const source = app.terminalDesks.find((desk) => desk.id === sourceId);
      return source ? [{ sourceId, targetId, host: source.host }] : [];
    });
    app.queueTerminalDeskMerges(jobs);
    return;
  }
  if (action === "duplicate") {
    app.openAnotherTerminal(command?.host || "");
    return;
  }
  if (action === "move-transfer") {
    if (!command?.transferId) return;
    try {
      const transfer = await api.takeTerminalTransfer(command.transferId);
      const deskId = app.openTransferredTerminal(transfer);
      if (deskId && command.targetDeskId) {
        app.reorderTerminalDesk(deskId, command.targetDeskId, command.insertBefore === true);
      }
    } catch (err) {
      console.error("领取终端会话失败", err);
    }
    return;
  }

  // 菜单和快捷键动作统一交给现有 TerminalModule 处理。
  app.runTermAction(action);
}

function emitTerminalState() {
  void Events.Emit("terminal-state", {
    count: app.terminalDesks.filter((desk) => !!desk.host).length,
    activeId: app.activeTerminalId,
  });
}

function onGlobalKeydown(e: KeyboardEvent) {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
  if (isTermNewShortcut(e, isMac)) {
    e.preventDefault();
    void applyCommand({ action: "new" });
    return;
  }
  if (!isTermAppShortcut(e, isMac)) return;

  let action = "";
  if (e.shiftKey && e.code === "KeyL") action = "sessions";
  else if (e.shiftKey && e.code === "KeyM") action = "detach";
  else if (e.shiftKey && e.code === "KeyW") action = "close-session";
  else if (e.shiftKey && e.code === "KeyD") action = "split-down";
  else if (!e.shiftKey && e.code === "KeyD") action = "split-right";
  else if (!e.shiftKey && e.code === "KeyW") action = "close-pane";
  else if (e.shiftKey && e.code === "KeyH") action = "return-host";
  if (!action) return;
  e.preventDefault();
  void applyCommand({ action });
}

const eventOffs: (() => void)[] = [];

onMounted(() => {
  window.addEventListener("keydown", onGlobalKeydown, true);
  eventOffs.push(
    Events.On("terminal-window-command", (ev: { data?: main.TerminalWindowCommand }) => {
      void applyCommand(ev?.data);
    }) as unknown as () => void
  );
  eventOffs.push(
    Events.On(
      "terminal-window-drop",
      (ev: {
        data?: {
          sourceWindowId?: string;
          sourceDeskId?: string;
          targetWindowId?: string;
          targetDeskId?: string;
          insertBefore?: boolean;
        };
      }) => {
        const data = ev?.data;
        if (!data || data.sourceWindowId !== app.windowId || !data.sourceDeskId) return;
        app.activateTerminalDesk(data.sourceDeskId);
        app.runTermAction("move-to-window", {
          targetWindowId: data.targetWindowId || "",
          targetDeskId: data.targetDeskId || "",
          insertBefore: data.insertBefore ? "1" : "0",
        });
      }
    ) as unknown as () => void
  );
  eventOffs.push(
    Events.On("terminal-empty-cancel", () => {
      void api.hideTerminalWindow(app.windowId);
    }) as unknown as () => void
  );
  void Window.IsMaximised().then((value) => {
    maximised.value = value;
  });

  void app.refresh().then(async () => {
    const pending = await api.terminalWindowReady(app.windowId);
    for (const command of pending) {
      await applyCommand(command);
    }
    emitTerminalState();
  });
});

watch(
  () => [
    app.activeTerminalId,
    ...app.terminalDesks.map((desk) => `${desk.id}:${desk.host}:${desk.crossHost}`),
  ],
  emitTerminalState,
  { flush: "post" }
);

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onGlobalKeydown, true);
  eventOffs.forEach((off) => off());
  eventOffs.length = 0;
});
</script>
