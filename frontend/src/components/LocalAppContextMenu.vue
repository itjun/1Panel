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
      ref="menuEl"
      class="host-ctx-menu"
      :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
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
      <template v-if="canKill">
        <div class="ctx-divider" />
        <button type="button" class="ctx-item is-danger" @click="killSelected">
          {{ menu.node.kind === "app" ? "结束应用" : "结束进程" }}
        </button>
      </template>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 本机应用树行右键菜单：查看详情（独立卡片）/ 复制 / 结束进程或应用。
 * 样式复用 HostContextMenu 的 .host-ctx-menu（挂 body）。
 */
import { computed, nextTick, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { copyText } from "@/utils/clipboard";
import { clampContextMenuPos } from "@/utils/contextMenuPos";
import { formatBytes, formatDurationLong, formatErr } from "@/utils/format";
import {
  confirmAndKillLocalProcs,
  type LocalKillTarget,
} from "@/utils/localAppsKill";
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
  /** 应用行：可结束的子进程列表（已排除自身） */
  killTargets?: LocalKillTarget[];
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

const menuEl = ref<HTMLElement | null>(null);
const pos = reactive({ x: 0, y: 0 });

watch(
  () => props.menu,
  async (m) => {
    if (!m) return;
    pos.x = m.x;
    pos.y = m.y;
    await nextTick();
    const el = menuEl.value;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const next = clampContextMenuPos(m.x, m.y, r.width, r.height);
    pos.x = next.x;
    pos.y = next.y;
  }
);

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

const killTargets = computed((): LocalKillTarget[] => {
  const n = node.value;
  if (!n) return [];
  if (n.kind === "proc") {
    if (!n.pid || isSelf.value) return [];
    return [{ pid: n.pid, name: n.name, cmd: n.cmd }];
  }
  if (n.kind === "app") {
    return n.killTargets || [];
  }
  return [];
});

const canKill = computed(() => killTargets.value.length > 0);

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

async function killSelected() {
  const n = node.value;
  const targets = killTargets.value;
  emit("close");
  if (!n || !targets.length) return;
  if (n.kind === "proc" && isSelf.value) {
    ElMessage.warning("不能结束本程序自身");
    return;
  }

  let title = "结束进程";
  let summary: string | undefined;
  if (n.kind === "app") {
    title = "结束应用";
    summary = `确定要结束应用「${n.name}」下的 ${targets.length} 个进程吗？`;
  }

  const ok = await confirmAndKillLocalProcs(targets, { title, summary });
  if (ok) emit("killed");
}
</script>
