import { useSyncExternalStore } from "react";
import { Events } from "@wailsio/runtime";
import { api } from "@/api";
import type { main } from "@/api";

/*
  应用内更新状态：后端 update-state 事件推全量快照，这里镜像一份供弹窗与「关于」页共用。
  update-available / update-show（点系统通知）以及启动时的 prompt 标记负责打开弹窗；
  update-check-failed（连不上更新源）打开手动下载引导弹窗。
*/

type Snapshot = {
  state: main.UpdateState | null;
  dialogOpen: boolean;
  failOpen: boolean;
};

let current: Snapshot = { state: null, dialogOpen: false, failOpen: false };
const listeners = new Set<() => void>();

function publish(next: Partial<Snapshot>) {
  current = { ...current, ...next };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppUpdate(): Snapshot {
  return useSyncExternalStore(subscribe, () => current);
}

export function setUpdateState(state: main.UpdateState) {
  const wasPrompt = !!current.state?.prompt;
  publish({ state });
  if (state.prompt && !wasPrompt) openUpdateDialog();
}

function syncFromBackend() {
  void api
    .getUpdateState()
    .then(setUpdateState)
    .catch(() => {
      /* 浏览器预览无后端 */
    });
}

export function openUpdateDialog() {
  if (current.state?.hasUpdate) publish({ dialogOpen: true });
}

export function closeUpdateDialog() {
  publish({ dialogOpen: false });
}

/** 连不上更新源的引导弹窗；已有可安装更新时不抢新版本弹窗。 */
export function openCheckFailDialog() {
  const s = current.state;
  if (s && !s.hasUpdate && s.checkFailed) publish({ failOpen: true });
}

export function closeCheckFailDialog() {
  publish({ failOpen: false });
}

/** 挂在应用根部调用一次，返回卸载函数。 */
export function initializeAppUpdate(): () => void {
  const offs = [
    Events.On("update-state", (ev: { data?: main.UpdateState }) => {
      if (ev?.data) setUpdateState(ev.data);
    }),
    Events.On("update-available", (ev: { data?: main.UpdateState }) => {
      if (ev?.data) setUpdateState(ev.data);
      openUpdateDialog();
    }),
    Events.On("update-check-failed", (ev: { data?: main.UpdateState }) => {
      if (ev?.data) setUpdateState(ev.data);
      openCheckFailDialog();
    }),
    Events.On("update-show", () => {
      void api.getUpdateState().then((state) => {
        setUpdateState(state);
        if (state.hasUpdate) openUpdateDialog();
        else openCheckFailDialog();
      });
    }),
  ];
  // 窗口在后台时可能错过事件：回到前台再对一次状态；
  // 顺带请求后端尽快补一次检查（节流），弥补 6 小时轮询的滞后
  const onFocus = () => {
    syncFromBackend();
    void api.pokeUpdateCheck().catch(() => {
      /* 浏览器预览无后端 */
    });
  };
  window.addEventListener("focus", onFocus);
  syncFromBackend();
  return () => {
    offs.forEach((off) => off());
    window.removeEventListener("focus", onFocus);
  };
}
