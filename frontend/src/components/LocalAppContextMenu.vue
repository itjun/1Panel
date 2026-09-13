<template>
  <Teleport to="body">
    <div
      v-if="menu"
      class="host-ctx-backdrop"
      @mousedown="emit('close')"
      @contextmenu.prevent="emit('close')"
    />
    <div
      v-if="menu"
      class="host-ctx-menu"
      :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
      @mousedown.stop
    >
      <button type="button" class="ctx-item" @click="openDetail">
        查看详情
      </button>
      <div class="ctx-divider" />
      <button type="button" class="ctx-item" @click="copyAll">
        复制全部信息
      </button>
      <button
        v-if="menu.node.kind !== 'thr'"
        type="button"
        class="ctx-item"
        :disabled="!startCmd"
        @click="copyStartCmd"
      >
        复制启动命令
      </button>
      <button
        v-if="menu.node.kind === 'proc'"
        type="button"
        class="ctx-item"
        :disabled="!cdAndCmd"
        @click="copyCdAndCmd"
      >
        复制 cd && cmd
      </button>
      <template v-if="menu.node.kind === 'proc' && menu.node.pid && !isSelf">
        <div class="ctx-divider" />
        <button type="button" class="ctx-item is-danger" @click="killProc">
          结束进程
        </button>
      </template>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 本机应用树行右键菜单：查看详情（独立卡片）/ 复制 / 结束进程。
 * 样式复用 HostContextMenu 的 .host-ctx-menu（挂 body）。
 */
import { computed, h, reactive } from "vue";
import { ElCheckbox, ElMessage, ElMessageBox } from "element-plus";
import { api } from "@/api";
import { copyText } from "@/utils/clipboard";
import { formatBytes, formatDurationLong, formatErr } from "@/utils/format";
import { localLangLabel } from "@/utils/localLang";

export type LocalCardKind = "app" | "proc" | "thr";

/** 右键菜单 / 树行 / 详情卡共用的摘要节点 */
export interface LocalCardNode {
  kind: LocalCardKind;
  id: string;
  name: string;
  runtime?: string;
  pid?: number;
  ppid?: number;
  tid?: number;
  user?: string;
  cpu: number;
  rss?: number;
  procCount?: number;
  threadCount?: number;
  elapsed?: number;
  exe?: string;
  cwd?: string;
  cmd?: string;
  ports?: number[];
  extra?: Record<string, string> | null;
  state?: string;
}

export interface LocalAppCtxMenuState {
  x: number;
  y: number;
  node: LocalCardNode;
}

const props = defineProps<{ menu: LocalAppCtxMenuState | null }>();

const emit = defineEmits<{
  close: [];
  killed: [];
  /** 打开独立详情卡片；携带点击坐标便于贴边摆放 */
  detail: [payload: { node: LocalCardNode; x: number; y: number }];
}>();

const node = computed(() => props.menu?.node ?? null);

const extraEntries = computed(() => {
  const ex = node.value?.extra;
  if (!ex) return [] as [string, string][];
  return Object.entries(ex).filter(([, v]) => v != null && String(v).length > 0) as [
    string,
    string,
  ][];
});

const startCmd = computed(() => (node.value?.cmd || "").trim());

const isSelf = computed(() => node.value?.extra?.self === "1");

const cdAndCmd = computed(() => {
  const cwd = (node.value?.cwd || "").trim();
  const cmd = startCmd.value;
  if (!cwd || !cmd) return "";
  return `cd ${shellQuote(cwd)} && ${cmd}`;
});

function fmtCpu(n: number | undefined) {
  return Number(n || 0).toFixed(2);
}

function runtimeLabel(rt: string) {
  return localLangLabel(rt);
}

function shellQuote(path: string) {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(path)) return path;
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

function openDetail() {
  const m = props.menu;
  if (!m) return;
  emit("detail", { node: m.node, x: m.x, y: m.y });
  emit("close");
}

async function copyAll() {
  const n = node.value;
  emit("close");
  if (!n) return;
  const lines: string[] = [];
  if (n.kind === "thr") {
    lines.push(
      `### 线程 ${n.name || n.tid}`,
      `- TID: ${n.tid ?? "—"}`,
      `- 所属 PID: ${n.pid ?? "—"}`,
      `- CPU: ${fmtCpu(n.cpu)}%`,
      `- 状态: ${n.state || "—"}`,
      `- 说明: 线程不单独统计内存 / 磁盘 / 网络`
    );
  } else if (n.kind === "app") {
    lines.push(
      `### 应用 ${n.name}`,
      `- 运行时: ${runtimeLabel(n.runtime || "")}`,
      `- 进程 / 线程: ${n.procCount ?? 0} / ${n.threadCount ?? 0}`,
      `- CPU: ${fmtCpu(n.cpu)}%`,
      `- 内存 RSS: ${formatBytes(n.rss || 0)}`
    );
  } else {
    lines.push(
      `### 进程 ${n.name || n.pid}`,
      `- PID / PPID: ${n.pid ?? "—"} / ${n.ppid ?? "—"}`,
      `- 用户: ${n.user || "—"}`,
      `- 运行时: ${runtimeLabel(n.runtime || "")}`,
      `- CPU: ${fmtCpu(n.cpu)}%`,
      `- 内存 RSS: ${formatBytes(n.rss || 0)}`,
      `- 线程数: ${n.threadCount ?? "—"}`,
      `- 已运行: ${n.elapsed != null ? formatDurationLong(n.elapsed) : "—"}`,
      `- 可执行: ${n.exe || "—"}`,
      `- 工作目录: ${n.cwd || "—"}`,
      `- 端口: ${(n.ports || []).join("、") || "—"}`,
      `- 命令: ${n.cmd || "—"}`
    );
    for (const [k, v] of extraEntries.value) {
      lines.push(`- ${k}: ${v}`);
    }
  }
  try {
    await copyText(lines.join("\n"));
    ElMessage.success("已复制全部信息");
  } catch (e) {
    ElMessage.error(`复制失败: ${formatErr(e)}`);
  }
}

async function copyStartCmd() {
  const text = startCmd.value;
  emit("close");
  if (!text) {
    ElMessage.warning("启动命令为空");
    return;
  }
  try {
    await copyText(text);
    ElMessage.success("启动命令已复制");
  } catch (e) {
    ElMessage.error(`复制失败: ${formatErr(e)}`);
  }
}

async function copyCdAndCmd() {
  const text = cdAndCmd.value;
  emit("close");
  if (!text) {
    ElMessage.warning("缺少工作目录或命令");
    return;
  }
  try {
    await copyText(text);
    ElMessage.success("已复制 cd && cmd");
  } catch (e) {
    ElMessage.error(`复制失败: ${formatErr(e)}`);
  }
}

async function killProc() {
  const n = node.value;
  emit("close");
  if (!n || n.kind !== "proc" || !n.pid) return;
  if (n.extra?.self === "1") {
    ElMessage.warning("不能结束本程序自身");
    return;
  }

  const state = reactive({ force: false });
  try {
    await ElMessageBox({
      title: "结束进程",
      message: () =>
        h("div", { class: "local-kill-box" }, [
          h(
            "p",
            { style: "margin: 0 0 8px; white-space: pre-wrap; word-break: break-all;" },
            `确定要结束进程 ${n.pid} 吗？\n${(n.cmd || "").slice(0, 160)}`
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
      confirmButtonText: "结束进程",
      cancelButtonText: "取消",
      confirmButtonClass: "el-button--danger",
      type: "warning",
    });
  } catch {
    return;
  }

  try {
    await api.localAppsKill(n.pid, state.force);
    let okMsg = "已发送 SIGTERM";
    if (state.force) {
      okMsg = "已发送 SIGKILL";
    }
    ElMessage.success(okMsg);
    emit("killed");
  } catch (e) {
    ElMessage.error(`结束失败: ${formatErr(e)}`);
  }
}
</script>

<style>
.local-kill-box .el-checkbox {
  margin-top: 4px;
}
</style>
