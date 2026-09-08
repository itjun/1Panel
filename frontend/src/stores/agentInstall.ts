import { defineStore } from "pinia";
import { ref } from "vue";
import { Events } from "@wailsio/runtime";
import { ElMessage } from "element-plus";
import { api } from "@/api";
import type { agentcli } from "@/api";
import { formatErr } from "@/utils/format";

/** 安装步骤 key，与 Go 侧 agent-install-progress 的 step 一致 */
export type InstallStepKey = "probe" | "upload" | "replace" | "start" | "verify";
export type InstallStepState = "pending" | "running" | "done" | "error";

/** 单条安装步骤的展示状态 */
export interface InstallStep {
  key: InstallStepKey;
  label: string;
  state: InstallStepState;
  percent: number; // 仅 upload 有意义（0~100）
}

const STEP_DEFS: { key: InstallStepKey; label: string }[] = [
  { key: "probe", label: "探测主机状态" },
  { key: "upload", label: "上传 Agent 二进制" },
  { key: "replace", label: "校验并替换二进制" },
  { key: "start", label: "启动服务并等待就绪" },
  { key: "verify", label: "验证版本一致性" },
];

/** Go 侧 agent-install-progress 事件载荷 */
interface InstallProgressEvent {
  host: string;
  step: string;
  percent: number;
  text?: string;
}

export const useAgentInstallStore = defineStore("agentInstall", () => {
  const visible = ref(false);
  const host = ref("");
  const running = ref(false);
  const error = ref("");
  const resultText = ref(""); // 完成文案（含安装到的版本）
  const steps = ref<InstallStep[]>([]);
  /** 最近一次安装成功；概览/分组页 watch 后刷新 Agent 状态 */
  const lastInstalled = ref<{ host: string; seq: number } | null>(null);

  const checkOpen = ref(false);
  const checkHost = ref("");
  const checking = ref(false);
  const checkReport = ref<agentcli.CheckReport | null>(null);

  async function runCheck(h: string) {
    const name = (h || "").trim();
    if (!name) return;
    checkHost.value = name;
    checking.value = true;
    try {
      checkReport.value = await api.checkAgent(name);
    } catch (e) {
      checkReport.value = {
        ok: false,
        summary: "检查失败",
        items: [
          {
            key: "comm",
            name: "通信",
            ok: false,
            detail: formatErr(e),
          },
        ],
      };
    } finally {
      checking.value = false;
    }
  }

  function openCheck(h: string) {
    const name = (h || "").trim();
    if (!name) return;
    checkHost.value = name;
    checkReport.value = null;
    checkOpen.value = true;
    void runCheck(name);
  }

  function closeCheck() {
    if (checking.value) return;
    checkOpen.value = false;
  }

  function markRunningError() {
    const cur = steps.value.find((s) => s.state === "running");
    if (cur) cur.state = "error";
  }

  /** 应用一条进度事件到步骤条（仅当 host 匹配且对话框打开） */
  function applyEvent(d: InstallProgressEvent) {
    if (d.host !== host.value || !visible.value) {
      return;
    }
    if (d.step === "done") {
      steps.value.forEach((s) => (s.state = "done"));
      resultText.value = d.text || "安装完成";
      return;
    }
    if (d.step === "error") {
      error.value = d.text || "安装失败";
      markRunningError();
      return;
    }
    const idx = steps.value.findIndex((s) => s.key === d.step);
    if (idx < 0) {
      return;
    }
    for (let i = 0; i < idx; i++) {
      if (steps.value[i].state !== "error") {
        steps.value[i].state = "done";
      }
    }
    steps.value[idx].state = "running";
    if (d.percent >= 0) {
      steps.value[idx].percent = d.percent;
    }
  }

  Events.On("agent-install-progress", (ev: { data?: InstallProgressEvent }) => {
    const d = ev?.data;
    if (d) applyEvent(d);
  });

  /**
   * 发起单台安装并打开进度对话框。
   * @returns 是否安装成功（过程与失败详情都在对话框内展示）
   */
  async function start(h: string): Promise<boolean> {
    if (running.value) {
      ElMessage.warning(`「${host.value}」的安装仍在进行中，请等待完成`);
      visible.value = true;
      return false;
    }
    host.value = h;
    error.value = "";
    resultText.value = "";
    checkReport.value = null;
    steps.value = STEP_DEFS.map((d) => ({
      ...d,
      state: "pending" as const,
      percent: 0,
    }));
    visible.value = true;
    running.value = true;
    try {
      await api.installAgent(h);
      lastInstalled.value = { host: h, seq: (lastInstalled.value?.seq ?? 0) + 1 };
      running.value = false;
      await runCheck(h);
      return true;
    } catch (e) {
      console.error("[agent-install] 失败:", e);
      error.value = error.value || formatErr(e);
      markRunningError();
      return false;
    } finally {
      running.value = false;
    }
  }

  /** 关闭对话框（安装进行中不允许关闭） */
  function close() {
    if (running.value) {
      return;
    }
    visible.value = false;
  }

  return {
    visible,
    host,
    running,
    error,
    resultText,
    steps,
    lastInstalled,
    checkOpen,
    checkHost,
    checking,
    checkReport,
    start,
    close,
    runCheck,
    openCheck,
    closeCheck,
  };
});
