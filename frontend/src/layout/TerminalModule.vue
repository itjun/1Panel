<template>
  <div class="term-mod no-drag">
    <div class="term-stage">
      <template v-for="desk in app.terminalDesks" :key="desk.id">
        <div
          v-if="app.isTerminalDeskVisible(desk.id)"
          class="term-stage__desk"
        >
          <TerminalView :host="desk.host" :workspace-session-id="desk.id" />
        </div>
      </template>
      <TermHostPick
        v-if="app.terminalPickerOpen || app.terminalDesks.length === 0"
        :overlay="app.terminalDesks.length > 0"
        @cancel="app.cancelTerminalPicker"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from "vue";
import { ElMessageBox } from "element-plus";
import { Events } from "@wailsio/runtime";
import { useAppStore } from "@/stores/app";
import TermHostPick from "@/views/TermHostPick.vue";
import TerminalView from "@/views/TerminalView.vue";

const app = useAppStore();

async function confirmDisconnect(host: string) {
  const name = (host || app.terminalFocusHost || "").trim();
  if (!name) return;
  const message = `将关闭 ${name} 的全部终端会话，并断开 SSH。含这台主机的分屏也会关掉。主机管理页不会关闭。`;
  try {
    await ElMessageBox.confirm(message, "断开连接", {
      type: "warning",
      confirmButtonText: "断开连接",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  await app.disconnectHostLink(name);
}

function applyAction(name: string) {
  if (app.workspace !== "terminal") return;
  if (name === "return-host" || name === "return-overview") app.returnToHost("overview");
  if (name === "return-files") app.returnToHost("files");
  if (name === "return-monitor") app.returnToHost("monitor");
  if (name === "return-services") app.returnToHost("services");
  if (name === "close-session" && app.activeTerminalId) {
    app.closeTerminalDesk(app.activeTerminalId);
  }
  if (name === "disconnect-host") void confirmDisconnect(app.terminalFocusHost);
}

watch(
  () => app.termActionN,
  () => applyAction(app.termActionName)
);

let offAction: (() => void) | null = null;

onMounted(() => {
  offAction = Events.On("term:action", (ev: { data?: unknown }) => {
    const name = typeof ev?.data === "string" ? ev.data : "";
    if (name) app.runTermAction(name);
  }) as unknown as () => void;
});

onBeforeUnmount(() => {
  offAction?.();
});
</script>

<style scoped lang="scss">
.term-mod {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
  background: #000;
  color: var(--m3-on-surface);

  button {
    appearance: none;
    border: 1px solid transparent;
    background: transparent;
    color: inherit;
    font: var(--m3-label-large);
    cursor: pointer;
  }
}

.term-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  overflow: hidden;
  background: #000;
}

.term-stage__desk {
  position: relative;
  z-index: 1;
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
}
</style>
