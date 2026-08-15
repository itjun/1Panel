<template>
  <div class="tab-root" v-loading="loading && !list.length">
    <EnlargableCard title="Java 进程">
    <div class="toolbar">
      <el-input
        v-model="filter"
        size="large"
        clearable
        class="filter"
        placeholder="按 jar/命令/用户/PID 过滤..."
      />
      <el-button size="large" @click="refresh">刷新</el-button>
      <span class="count">{{ filtered.length }} 个</span>
    </div>
    <el-alert v-if="error && !list.length" type="error" :title="error" show-icon />

    <el-table
      v-if="filtered.length || loading"
      :data="filtered"
      height="100%"
      size="small"
      stripe
      @cell-mouse-enter="onRowEnter"
      @cell-mouse-leave="scheduleHide"
      @cell-click="onCellClick"
    >
      <el-table-column prop="pid" label="PID" width="80" />
      <el-table-column prop="user" label="用户" width="90" show-overflow-tooltip />
      <el-table-column label="部署方式" width="100">
        <template #default="{ row }">
          <el-tag size="small" :type="deployTagType(row.deploy)">
            {{ deployLabel(row) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="应用" min-width="200" show-overflow-tooltip>
        <template #default="{ row }">
          <span :title="row.jar || appName(row)">{{ displayName(row) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="端口" width="130" show-overflow-tooltip>
        <template #default="{ row }">
          <span class="mono">{{ (row.ports || []).join(" ") || "—" }}</span>
        </template>
      </el-table-column>
      <el-table-column label="CPU%" width="80" sortable :sort-method="sortCpu">
        <template #default="{ row }">
          <span :class="row.cpu > 80 ? 'danger' : row.cpu > 30 ? 'warn' : ''">
            {{ Number(row.cpu || 0).toFixed(1) }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="内存" width="90">
        <template #default="{ row }">{{ formatBytes(row.rss || 0) }}</template>
      </el-table-column>
      <el-table-column label="堆内存 (Xms~Xmx)" width="150">
        <template #default="{ row }">
          <span class="mono" v-if="row.xms || row.xmx">
            {{ row.xms ? formatBytes(row.xms) : "默认" }}~{{ row.xmx ? formatBytes(row.xmx) : "默认" }}
          </span>
          <span v-else class="dim">—</span>
        </template>
      </el-table-column>
      <el-table-column label="运行时长" width="110">
        <template #default="{ row }">{{ fmtElapsed(row.elapsed || 0) }}</template>
      </el-table-column>
      <el-table-column prop="args" label="启动命令" min-width="260" show-overflow-tooltip />
    </el-table>

    <el-empty
      v-if="!loading && list.length === 0 && !error"
      description="未发现运行中的 Java 进程"
    />
    </EnlargableCard>

    <!-- 跟随鼠标的详情卡片：固定定位 + 视口内自动避让；
         悬浮时不参与鼠标事件，点击行固定（pinned）后可交互、可选择文本、可复制 -->
    <Teleport to="body">
      <div
        v-if="card.visible && card.proc"
        class="java-hover-card"
        :class="{ pinned: card.pinned }"
        :style="{ left: card.x + 'px', top: card.y + 'px' }"
      >
        <div class="detail-title">
          {{ card.proc.jar ? jarName(card.proc.jar) : appName(card.proc) }}
          <span class="pid-tag mono">PID {{ card.proc.pid }}</span>
          <span class="flex-spacer" />
          <el-button
            v-if="card.pinned"
            size="small"
            text
            class="close-btn"
            @click="unpin"
          >
            ×
          </el-button>
        </div>
        <div class="detail-rows">
          <div class="d-row">
            <span class="k">用户</span>
            <span class="v mono">{{ card.proc.user || "—" }}</span>
          </div>
          <div class="d-row">
            <span class="k">部署方式</span>
            <span class="v">{{ deployLabel(card.proc) }}</span>
          </div>
          <div class="d-row" v-if="card.proc.service">
            <span class="k">systemd</span>
            <span class="v mono">{{ card.proc.service }}</span>
          </div>
          <div class="d-row" v-if="card.proc.container">
            <span class="k">容器</span>
            <span class="v mono">
              {{ card.proc.container }}（{{ card.proc.image || "镜像未知" }}）
            </span>
          </div>
          <div class="d-row">
            <span class="k">jar 包</span>
            <span class="v mono break">{{ card.proc.jar || "—（非 jar 启动）" }}</span>
          </div>
          <div class="d-row">
            <span class="k">监听端口</span>
            <span class="v mono">{{ (card.proc.ports || []).join("、") || "—" }}</span>
          </div>
          <div class="d-row">
            <span class="k">CPU / 内存</span>
            <span class="v mono">
              {{ Number(card.proc.cpu || 0).toFixed(2) }}% /
              {{ formatBytes(card.proc.rss || 0) }}（{{ Number(card.proc.mem || 0).toFixed(1) }}%）
            </span>
          </div>
          <div class="d-row">
            <span class="k">堆内存</span>
            <span class="v mono">
              <template v-if="card.proc.xms || card.proc.xmx">
                {{ card.proc.xms ? formatBytes(card.proc.xms) : "默认" }} ~
                {{ card.proc.xmx ? formatBytes(card.proc.xmx) : "默认" }}（Xms ~ Xmx）
              </template>
              <template v-else>—（未显式设置 -Xms/-Xmx）</template>
            </span>
          </div>
          <div class="d-row">
            <span class="k">已运行</span>
            <span class="v">{{ fmtElapsed(card.proc.elapsed || 0) }}</span>
          </div>
          <div class="d-row" v-if="detailOf(card.proc.pid)">
            <div class="d-row" style="padding: 0">
              <span class="k">工作目录</span>
              <span class="v mono break">{{ detailOf(card.proc.pid)?.workDir || "—（无权限）" }}</span>
            </div>
            <div class="d-row" style="padding: 0">
              <span class="k">java 路径</span>
              <span class="v mono break">{{ detailOf(card.proc.pid)?.exePath || "—（无权限）" }}</span>
            </div>
            <div class="d-row" style="padding: 0">
              <span class="k">磁盘 IO</span>
              <span class="v mono">
                <template v-if="detailOf(card.proc.pid)?.readBytes || detailOf(card.proc.pid)?.writeBytes">
                  读{{ formatBytes(detailOf(card.proc.pid)!.readBytes) }}
                  写{{ formatBytes(detailOf(card.proc.pid)!.writeBytes) }}（累计）
                </template>
                <template v-else>—（无 /proc/io 读取权限）</template>
              </span>
            </div>
          </div>
          <div class="d-row">
            <span class="k">命令行</span>
            <span class="v mono break">{{ card.proc.args || "—" }}</span>
          </div>
        </div>
        <div v-if="card.pinned" class="card-actions">
          <el-button size="small" @click="copyProcInfo">复制进程信息</el-button>
          <el-button size="small" @click="copyArgs">复制命令行</el-button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { api } from "@/api";
import { usePolling } from "@/composables/usePolling";
import EnlargableCard from "@/components/EnlargableCard.vue";
import { formatBytes } from "@/utils/format";
import { copyText } from "@/utils/clipboard";

interface JavaProc {
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  rss: number;
  elapsed: number;
  args: string;
  jar: string;
  xms: number;
  xmx: number;
  ports: string[];
  deploy: string;
  service: string;
  container: string;
  image: string;
}
interface JavaProcDetail {
  pid: number;
  workDir: string;
  exePath: string;
  readBytes: number;
  writeBytes: number;
}

const props = defineProps<{ host: string }>();
const filter = ref("");

const { data, error, loading, refresh } = usePolling<JavaProc[]>(
  () => api.collectJavaProcs(props.host) as Promise<JavaProc[]>,
  8000,
  () => props.host
);
const list = computed(() => data.value || []);
const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase();
  if (!q) return list.value;
  return list.value.filter(
    (p) =>
      (p.jar || "").toLowerCase().includes(q) ||
      (p.args || "").toLowerCase().includes(q) ||
      (p.user || "").toLowerCase().includes(q) ||
      String(p.pid).includes(q)
  );
});

/** 详情按 PID 缓存；首次悬浮时查询一次（失败返回 null，卡片照常显示列表已有信息） */
const detailMap = reactive<Record<number, JavaProcDetail | null>>({});
const pending = new Set<number>();
function detailOf(pid: number): JavaProcDetail | null | undefined {
  if (detailMap[pid] === undefined && !pending.has(pid)) {
    pending.add(pid);
    api
      .collectJavaDetail(props.host, pid)
      .then((d) => (detailMap[pid] = d as JavaProcDetail))
      .catch(() => (detailMap[pid] = null));
  }
  return detailMap[pid];
}

/** 跟随鼠标的悬浮卡片：行数据直接引用，无需回列表查找；
 *  点击行进入 pinned 状态（位置固定、可交互、可复制），再点同行或 × 取消 */
const card = reactive({
  visible: false,
  pinned: false,
  proc: null as JavaProc | null,
  x: 0,
  y: 0,
});
const CARD_W = 420;
const CARD_EST_H = 420;
let hideTimer: number | undefined;

function placeCard(e: MouseEvent) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let x = e.clientX + 16;
  let y = e.clientY + 16;
  if (x + CARD_W > vw - 8) x = Math.max(8, e.clientX - CARD_W - 16);
  if (y + CARD_EST_H > vh - 8) y = Math.max(8, e.clientY - CARD_EST_H - 16);
  card.x = x;
  card.y = y;
}
function onRowEnter(row: JavaProc, _col: unknown, _cell: unknown, e: MouseEvent) {
  if (card.pinned) return; // 固定期间不跟随不切换
  clearTimeout(hideTimer);
  card.proc = row;
  placeCard(e);
  card.visible = true;
  void detailOf(row.pid);
}
/** el-table 的 cell-mouse-leave 在行间移动时会触发，延迟隐藏避免闪烁 */
function scheduleHide() {
  if (card.pinned) return;
  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => (card.visible = false), 200);
}
/** 点击行：固定卡片（再点同一行取消固定，点其他行切换固定目标） */
function onCellClick(row: JavaProc, _col: unknown, _cell: unknown, e: MouseEvent) {
  if (card.pinned && card.proc?.pid === row.pid) {
    card.pinned = false;
    card.visible = false;
    return;
  }
  card.proc = row;
  card.pinned = true;
  placeCard(e);
  card.visible = true;
  void detailOf(row.pid);
}
function unpin() {
  card.pinned = false;
  card.visible = false;
}

/** 列展示辅助 */
function deployLabel(p: JavaProc): string {
  if (p.deploy === "systemd") return "systemd";
  if (p.deploy === "docker") return "Docker";
  return "直跑";
}
function deployTagType(deploy: string): "primary" | "success" | "info" {
  if (deploy === "docker") return "primary";
  if (deploy === "systemd") return "success";
  return "info";
}
function displayName(p: JavaProc): string {
  return p.jar ? jarName(p.jar) : appName(p);
}
function jarName(jar: string): string {
  const i = jar.lastIndexOf("/");
  return i >= 0 ? jar.slice(i + 1) : jar;
}
/** 非 jar 启动时展示主类名（-cp/-classpath 后的词）或最后一个非选项参数 */
function appName(p: JavaProc): string {
  const fields = (p.args || "").split(/\s+/);
  for (let i = 0; i < fields.length; i++) {
    if (fields[i] === "-cp" || fields[i] === "-classpath") {
      if (fields[i + 2]) return fields[i + 2];
      const jars = (fields[i + 1] || "").split(":").filter((x) => x.endsWith(".jar"));
      if (jars.length) return jarName(jars[0]);
    }
  }
  for (let i = fields.length - 1; i >= 0; i--) {
    if (fields[i] && !fields[i].startsWith("-") && fields[i] !== "java") {
      return fields[i];
    }
  }
  return "java";
}
function sortCpu(a: JavaProc, b: JavaProc) {
  return (a.cpu || 0) - (b.cpu || 0);
}

/** 复制固定卡片的完整进程信息（格式化文本，方便直接贴给 AI 分析） */
async function copyProcInfo() {
  const p = card.proc;
  if (!p) return;
  const d = detailOf(p.pid);
  const lines = [
    `=== Java 进程信息（PID ${p.pid}）===`,
    `用户: ${p.user || "—"}`,
    `部署方式: ${deployLabel(p)}${p.service ? `（${p.service}）` : ""}${p.container ? `（容器 ${p.container}，镜像 ${p.image || "未知"}）` : ""}`,
    `jar 包: ${p.jar || "—（非 jar 启动）"}`,
    `监听端口: ${(p.ports || []).join("、") || "—"}`,
    `CPU: ${Number(p.cpu || 0).toFixed(2)}%`,
    `内存 RSS: ${formatBytes(p.rss || 0)}（${Number(p.mem || 0).toFixed(1)}%）`,
    `堆内存: ${p.xms || p.xmx ? `${p.xms ? formatBytes(p.xms) : "默认"} ~ ${p.xmx ? formatBytes(p.xmx) : "默认"}（Xms ~ Xmx）` : "未显式设置 -Xms/-Xmx"}`,
    `已运行: ${fmtElapsed(p.elapsed || 0)}`,
    `工作目录: ${d?.workDir || "—（无权限）"}`,
    `java 路径: ${d?.exePath || "—（无权限）"}`,
    `磁盘 IO(累计): ${d?.readBytes || d?.writeBytes ? `读 ${formatBytes(d.readBytes)} / 写 ${formatBytes(d.writeBytes)}` : "—（无 /proc/io 读取权限）"}`,
    `命令行: ${p.args || "—"}`,
  ];
  try {
    await copyText(lines.join("\n"));
    ElMessage.success("进程信息已复制");
  } catch {
    ElMessage.error("复制失败");
  }
}
async function copyArgs() {
  const text = (card.proc?.args || "").trim();
  if (!text) {
    ElMessage.warning("命令行为空");
    return;
  }
  try {
    await copyText(text);
    ElMessage.success("命令行已复制");
  } catch {
    ElMessage.error("复制失败");
  }
}
/** 秒 → 可读时长 */
function fmtElapsed(sec: number): string {
  if (!sec) return "—";
  if (sec < 60) return `${sec} 秒`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时 ${m % 60} 分`;
  return `${Math.floor(h / 24)} 天 ${h % 24} 小时`;
}
</script>

<style scoped>
.tab-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: 8px;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.filter {
  width: 240px;
}
.count {
  margin-left: auto;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.mono {
  font-variant-numeric: tabular-nums;
}
.dim {
  color: var(--el-text-color-placeholder);
}
.warn {
  color: var(--el-color-warning);
  font-weight: 600;
}
.danger {
  color: var(--el-color-danger);
  font-weight: 600;
}
:deep(.el-table) {
  flex: 1;
}
</style>

<style>
/* 跟随鼠标的详情卡片（Teleport 到 body，scoped 不生效）；
   pointer-events:none 保证不挡鼠标、不闪烁 */
.java-hover-card {
  position: fixed;
  z-index: 3000;
  width: 420px;
  max-height: 70vh;
  overflow-y: auto;
  padding: 12px 14px;
  border-radius: 8px;
  background: var(--el-bg-color-overlay, #fff);
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
  font-size: 12px;
  color: var(--el-text-color-primary, #303133);
  pointer-events: none;
}
/* 点击行固定后：可交互（选择文本/点按钮），主题色边框区分 */
.java-hover-card.pinned {
  pointer-events: auto;
  z-index: 3001;
  border-color: var(--el-color-primary);
}
.java-hover-card .flex-spacer {
  flex: 1;
}
.java-hover-card .close-btn {
  padding: 0 4px;
  font-size: 14px;
}
.java-hover-card .card-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--el-border-color-lighter);
}
.java-hover-card .detail-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.java-hover-card .pid-tag {
  font-weight: 400;
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
.java-hover-card .d-row {
  display: flex;
  gap: 12px;
  padding: 3px 0;
  line-height: 1.5;
}
.java-hover-card .k {
  flex-shrink: 0;
  width: 72px;
  color: var(--el-text-color-secondary);
}
.java-hover-card .v {
  flex: 1;
  min-width: 0;
  word-break: break-all;
}
.java-hover-card .v.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
}
</style>
