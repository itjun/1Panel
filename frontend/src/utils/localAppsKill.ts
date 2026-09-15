/**
 * 本机应用进程结束：弹窗确认（可选强制 SIGKILL）后逐个 Kill。
 */
import { h, reactive } from "vue";
import { ElCheckbox, ElMessage, ElMessageBox } from "element-plus";
import { api } from "@/api";
import { formatErr } from "@/utils/format";

export interface LocalKillTarget {
  pid: number;
  name?: string;
  cmd?: string;
}

/**
 * @returns true 表示用户确认并已全部发送结束信号；取消或无可杀目标返回 false
 */
export async function confirmAndKillLocalProcs(
  targets: LocalKillTarget[],
  opts?: { title?: string; summary?: string }
): Promise<boolean> {
  const list = targets.filter((t) => t.pid > 0);
  if (!list.length) {
    ElMessage.warning("没有可结束的进程");
    return false;
  }

  const title = opts?.title || (list.length === 1 ? "结束进程" : "结束应用");
  let summary = opts?.summary || "";
  if (!summary) {
    if (list.length === 1) {
      const t = list[0];
      const cmdHint = (t.cmd || "").trim().slice(0, 160);
      summary = `确定要结束进程 ${t.pid}${t.name ? `（${t.name}）` : ""} 吗？`;
      if (cmdHint) {
        summary += `\n${cmdHint}`;
      }
    } else {
      const names = list
        .slice(0, 5)
        .map((t) => `${t.pid}${t.name ? ` ${t.name}` : ""}`)
        .join("\n");
      const more = list.length > 5 ? `\n…共 ${list.length} 个进程` : "";
      summary = `确定要结束以下 ${list.length} 个进程吗？\n${names}${more}`;
    }
  }

  const state = reactive({ force: false });
  try {
    await ElMessageBox({
      title,
      message: () =>
        h("div", { class: "local-kill-box" }, [
          h(
            "p",
            {
              style:
                "margin: 0 0 8px; white-space: pre-wrap; word-break: break-all;",
            },
            summary
          ),
          h(
            ElCheckbox,
            {
              modelValue: state.force,
              "onUpdate:modelValue": (v: string | number | boolean) => {
                state.force = !!v;
              },
            },
            () => "强制结束（SIGKILL）"
          ),
        ]),
      showCancelButton: true,
      confirmButtonText: list.length === 1 ? "结束进程" : "结束全部",
      cancelButtonText: "取消",
      confirmButtonClass: "el-button--danger",
      type: "warning",
    });
  } catch {
    return false;
  }

  let ok = 0;
  let lastErr: unknown = null;
  for (const t of list) {
    try {
      await api.localAppsKill(t.pid, state.force);
      ok += 1;
    } catch (e) {
      lastErr = e;
    }
  }

  if (ok === list.length) {
    let okMsg = "已发送 SIGTERM";
    if (state.force) {
      okMsg = "已发送 SIGKILL";
    }
    if (list.length > 1) {
      okMsg = `${okMsg}（${ok} 个）`;
    }
    ElMessage.success(okMsg);
    return true;
  }

  if (ok > 0) {
    ElMessage.warning(
      `已结束 ${ok}/${list.length} 个；其余失败: ${formatErr(lastErr)}`
    );
    return true;
  }

  ElMessage.error(`结束失败: ${formatErr(lastErr)}`);
  return false;
}
