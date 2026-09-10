import { ElMessage, ElMessageBox } from "element-plus";
import type { useAppStore } from "@/stores/app";

type AppStore = ReturnType<typeof useAppStore>;

/** 停止主机后台会话（与侧栏右键「停止会话」同一确认流） */
export async function confirmStopHostSession(
  app: AppStore,
  host: string
): Promise<void> {
  if (!host || !app.isRunning(host)) return;
  try {
    await ElMessageBox.confirm(
      `停止「${host}」的后台会话？重新打开将重新加载。`,
      "停止会话",
      {
        type: "warning",
        confirmButtonText: "停止",
        cancelButtonText: "取消",
      }
    );
    app.stopHost(host);
    ElMessage.success("已停止");
  } catch {
    /* 用户取消 */
  }
}
