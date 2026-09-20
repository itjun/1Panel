import { ElMessage } from "element-plus";
import type { useAppStore } from "@/stores/app";

type AppStore = ReturnType<typeof useAppStore>;

/**
 * 关闭主机管理页。还有终端时不断开 SSH。
 */
export async function confirmStopHostSession(
  app: AppStore,
  host: string
): Promise<void> {
  if (!host) return;
  const keepTerm = app.hostHasTerminal(host);
  const closed = await app.closeHostTab(host);
  if (!closed) return;
  if (keepTerm) {
    ElMessage.success("已关闭主机页，终端会话仍保留");
    return;
  }
  ElMessage.success("已断开");
}
