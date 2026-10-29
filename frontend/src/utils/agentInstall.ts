import { formatErr } from "./format";

export const AGENT_INSTALL_STEPS = [
  { key: "probe", label: "探测" },
  { key: "upload", label: "上传" },
  { key: "replace", label: "部署" },
  { key: "start", label: "启动" },
  { key: "verify", label: "验证" },
] as const;

type InstallStep = (typeof AGENT_INSTALL_STEPS)[number]["key"];

export type AgentInstallRow = {
  host: string;
  action?: "install" | "upgrade";
  state: "pending" | "running" | "done" | "error";
  step: InstallStep | "";
  percent?: number;
  text: string;
};

export type AgentInstallState = {
  phase: "idle" | "confirm" | "running" | "done";
  rows: AgentInstallRow[];
};

export type AgentInstallProgress = {
  host?: string;
  step?: string;
  percent?: number;
  text?: string;
};

type InstallResult = { host: string; ok: boolean; version: string; error?: string };
export type AgentRepairTarget = { host: string; action: "install" | "upgrade" };
type InstallDependencies = {
  install: (hosts: string[]) => Promise<InstallResult[]>;
  repair?: (targets: AgentRepairTarget[]) => Promise<InstallResult[]>;
  onProgress: (listener: (event: AgentInstallProgress) => void) => () => void;
};

/** 单台安装和批量修复共用一个会话，提交时锁定目标并同步防重。 */
export class AgentInstallController {
  private state: AgentInstallState = { phase: "idle", rows: [] };
  private repairTargets: AgentRepairTarget[] | null = null;
  private listeners = new Set<() => void>();

  constructor(private dependencies: InstallDependencies) {}

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(state: AgentInstallState) {
    this.state = state;
    this.listeners.forEach(listener => listener());
  }

  open(hosts: string[]) {
    if (this.state.phase === "running") return;
    const targets = [...new Set(hosts.filter(host => host.trim().length > 0))];
    if (!targets.length) return;
    this.repairTargets = null;
    this.publish({
      phase: "confirm",
      rows: targets.map(host => ({ host, state: "pending", step: "", text: "等待安装" })),
    });
  }

  async startRepair(targets: AgentRepairTarget[]) {
    if (this.state.phase === "running" || !targets.length) return;
    const seen = new Set<string>();
    const valid = targets.filter(target => {
      if (!target.host.trim() || seen.has(target.host)) return false;
      seen.add(target.host);
      return true;
    });
    if (!valid.length) return;
    this.repairTargets = valid;
    this.publish({ phase: "confirm", rows: valid.map(target => ({
      host: target.host, action: target.action, state: "pending", step: "", text: "等待安装",
    })) });
    await this.start();
  }

  retryFailed() {
    const failed = this.state.rows.filter(row => row.state === "error").map(row => row.host);
    if (this.repairTargets) {
      void this.startRepair(this.repairTargets.filter(target => failed.includes(target.host)));
    } else {
      this.open(failed);
    }
  }

  close() {
    if (this.state.phase === "running") return;
    this.publish({ phase: "idle", rows: [] });
  }

  private applyProgress(event: AgentInstallProgress) {
    if (this.state.phase !== "running") return;
    this.publish({ ...this.state, rows: this.state.rows.map(row => {
      if (row.host !== event.host || row.state === "done" || row.state === "error") return row;
      if (event.step === "error") return { ...row, state: "error", text: event.text || "安装失败" };
      if (event.step === "done") return { ...row, state: "done", text: event.text || "安装完成" };
      const index = AGENT_INSTALL_STEPS.findIndex(step => step.key === event.step);
      if (index < 0 || index < AGENT_INSTALL_STEPS.findIndex(step => step.key === row.step)) return row;
      const step = AGENT_INSTALL_STEPS[index];
      // start 的百分比是等待超时占比，只有 upload 表示实际传输进度。
      const percent = step.key === "upload" && typeof event.percent === "number" && Number.isFinite(event.percent) && event.percent >= 0
        ? Math.min(100, event.percent) : undefined;
      return { ...row, state: "running", step: step.key, percent, text: event.text || `正在${step.label}…` };
    }) });
  }

  async start() {
    if (this.state.phase !== "confirm" || !this.state.rows.length) return;
    const hosts = this.state.rows.map(row => row.host);
    this.publish({ ...this.state, phase: "running" });
    let off: (() => void) | undefined;
    try {
      off = this.dependencies.onProgress(event => this.applyProgress(event));
      if (this.repairTargets && !this.dependencies.repair) throw new Error("批量修复不可用");
      const results = this.repairTargets && this.dependencies.repair
        ? await this.dependencies.repair(this.repairTargets) : await this.dependencies.install(hosts);
      const byHost = new Map(results.map(result => [result.host, result]));
      this.publish({ phase: "done", rows: this.state.rows.map(row => {
        const result = byHost.get(row.host);
        if (!result) {
          return row.state === "done" || row.state === "error" ? row
            : { ...row, state: "error", text: "未收到安装结果，请检查 Agent 状态后重试" };
        }
        if (!result.ok) return { ...row, state: "error", text: result.error || "安装失败" };
        return { ...row, state: "done", text: row.state === "done" ? row.text : `安装完成${result.version ? ` · v${result.version}` : ""}` };
      }) });
    } catch (error) {
      this.publish({ phase: "done", rows: this.state.rows.map(row =>
        row.state === "done" || row.state === "error" ? row
          : { ...row, state: "error", text: formatErr(error) },
      ) });
    } finally {
      off?.();
    }
  }
}
