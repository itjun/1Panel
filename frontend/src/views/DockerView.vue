<template>
  <div class="tab-root" v-loading="loading && !data">
    <EnlargableCard title="Docker 容器">
    <el-alert v-if="error && !data" type="error" :title="error" show-icon />
    <template v-else-if="data && !data.available">
      <el-empty description="目标机未安装 Docker，或当前用户没有 docker 权限" />
    </template>
    <template v-else-if="data">
      <div class="toolbar">
        <span class="muted">共 {{ (data.containers || []).length }} 个容器</span>
        <el-button size="large" @click="refresh">刷新</el-button>
      </div>
      <div class="grid">
        <EnlargableCard
          v-for="c in data.containers || []"
          :key="c.id"
          bare
          :title="c.name"
        >
        <el-card
          shadow="never"
          class="card"
          @mouseenter="onCardEnter($event, c)"
          @mouseleave="scheduleHide"
        >
          <div class="head">
            <span class="dot" :class="{ on: c.state === 'running' }" />
            <span class="name" :title="c.name">{{ c.name }}</span>
            <el-tag size="small" :type="stateType(c.state)">{{ c.state }}</el-tag>
            <el-dropdown trigger="click">
              <el-button size="small" text :loading="busy === c.name">⋯</el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item
                    :disabled="c.state === 'running'"
                    @click="act(c.name, 'start')"
                  >
                    启动
                  </el-dropdown-item>
                  <el-dropdown-item
                    :disabled="c.state !== 'running'"
                    @click="act(c.name, 'stop')"
                  >
                    停止
                  </el-dropdown-item>
                  <el-dropdown-item @click="act(c.name, 'restart')">重启</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
          <div class="image muted">{{ c.image }}</div>
          <div class="row">
            <span class="muted">CPU</span>
            <span class="mono">{{ (statOf(c.name)?.cpuPercent || 0).toFixed(2) }}%</span>
          </div>
          <div class="row">
            <span class="muted">内存</span>
            <span class="mono">
              {{ formatBytes(statOf(c.name)?.memUsage || 0) }} /
              {{ formatBytes(statOf(c.name)?.memLimit || 0) }}
            </span>
          </div>
          <el-progress
            :percentage="Math.min(100, Number(statOf(c.name)?.memPercent || 0))"
            :stroke-width="6"
            :show-text="false"
          />
          <div class="status muted" :title="c.status">{{ c.status }}</div>
        </el-card>
        </EnlargableCard>
        <el-empty
          v-if="!(data.containers || []).length"
          class="full"
          description="没有容器"
        />
      </div>
    </template>
    </EnlargableCard>

    <!-- 悬浮详情卡片：贴在容器卡片右侧（空间不够翻到左侧），可交互（复制/查看按钮） -->
    <Teleport to="body">
      <div
        v-if="card.visible"
        class="dc-hover-card"
        :style="{ left: card.x + 'px', top: card.y + 'px' }"
        @mouseenter="cancelHide"
        @mouseleave="scheduleHide"
      >
        <template v-if="inspectOf(card.name)">
          <div class="detail-title">
            <span class="dot" :class="{ on: inspectOf(card.name)?.State?.Status === 'running' }" />
            {{ (inspectOf(card.name)?.Name || card.name).replace(/^\//, "") }}
            <el-tag size="small" :type="stateType(inspectOf(card.name)?.State?.Status || '')">
              {{ inspectOf(card.name)?.State?.Status || "未知" }}
            </el-tag>
          </div>
          <div class="detail-rows">
            <div class="d-row">
              <span class="k">容器 ID</span>
              <span class="v mono">{{ inspectOf(card.name)?.Id || "—" }}</span>
            </div>
            <div class="d-row">
              <span class="k">镜像</span>
              <span class="v mono">{{ inspectOf(card.name)?.Config?.Image || "—" }}</span>
            </div>
            <div class="d-row">
              <span class="k">创建时间</span>
              <span class="v">{{ fmtTime(inspectOf(card.name)?.Created) }}</span>
            </div>
            <div class="d-row">
              <span class="k">启动时间</span>
              <span class="v">{{ fmtTime(inspectOf(card.name)?.State?.StartedAt) }}</span>
            </div>
            <div class="d-row">
              <span class="k">主进程</span>
              <span class="v mono">
                PID {{ inspectOf(card.name)?.State?.Pid ?? "—" }} ·
                {{ cmdLine(inspectOf(card.name)!) || "—" }}
              </span>
            </div>
            <div class="d-row">
              <span class="k">工作目录</span>
              <span class="v mono">{{ inspectOf(card.name)?.Config?.WorkingDir || "/" }}</span>
            </div>
            <div class="d-row">
              <span class="k">运行用户</span>
              <span class="v mono">{{ inspectOf(card.name)?.Config?.User || "root" }}</span>
            </div>
            <div class="d-row">
              <span class="k">重启策略</span>
              <span class="v">{{ restartPolicy(inspectOf(card.name)!) }}</span>
            </div>
            <div class="d-row">
              <span class="k">网络模式</span>
              <span class="v mono">
                {{ inspectOf(card.name)?.HostConfig?.NetworkMode || "—" }}
                <template v-if="inspectOf(card.name)?.HostConfig?.Privileged">
                  · 特权模式
                </template>
              </span>
            </div>
            <div class="d-row" v-if="statOf(card.name)">
              <span class="k">网络 IO</span>
              <span class="v mono">
                ↓{{ formatBytes(statOf(card.name)!.netIn) }}
                ↑{{ formatBytes(statOf(card.name)!.netOut) }}（累计）
              </span>
            </div>
            <div class="d-row" v-if="statOf(card.name)">
              <span class="k">磁盘 IO</span>
              <span class="v mono">
                读{{ formatBytes(statOf(card.name)!.blockIn) }}
                写{{ formatBytes(statOf(card.name)!.blockOut) }}（累计）
              </span>
            </div>
          </div>

          <div class="section-title">端口映射</div>
          <div class="lines mono">
            <div v-if="!portLines(inspectOf(card.name)!).length" class="muted">—</div>
            <div v-for="(p, i) in portLines(inspectOf(card.name)!)" :key="'p' + i">{{ p }}</div>
          </div>

          <div class="section-title">磁盘映射 / 挂载</div>
          <div class="lines mono">
            <div v-if="!mountLines(inspectOf(card.name)!).length" class="muted">—</div>
            <div v-for="(m, i) in mountLines(inspectOf(card.name)!)" :key="'m' + i">{{ m }}</div>
          </div>

          <div class="section-title">网络</div>
          <div class="lines mono">
            <div v-if="!networkLines(inspectOf(card.name)!).length" class="muted">—</div>
            <div v-for="(n, i) in networkLines(inspectOf(card.name)!)" :key="'n' + i">{{ n }}</div>
          </div>

          <div class="section-title">环境变量</div>
          <div class="lines mono">
            <div v-if="!(inspectOf(card.name)?.Config?.Env || []).length" class="muted">—</div>
            <div v-for="(e, i) in inspectOf(card.name)?.Config?.Env || []" :key="'e' + i">
              {{ e }}
            </div>
          </div>

          <div class="card-actions">
            <el-button size="small" @click="copyJson(card.name)">复制 inspect JSON</el-button>
            <el-button size="small" @click="openJsonDialog(card.name)">查看 JSON</el-button>
          </div>
        </template>
        <div v-else-if="inspectOf(card.name) === null" class="detail-loading">
          查询容器详情失败
        </div>
        <div v-else class="detail-loading">
          <el-icon class="is-loading"><Loading /></el-icon>
          正在查询容器详情…
        </div>
      </div>
    </Teleport>

    <!-- inspect 完整 JSON 查看弹窗 -->
    <el-dialog
      v-model="jsonDialog.visible"
      :title="`docker inspect — ${jsonDialog.name}`"
      width="80%"
      top="4vh"
      class="json-dialog"
    >
      <div class="dialog-toolbar">
        <span class="muted">共 {{ jsonLineCount }} 行，可直接复制给 AI 分析</span>
        <el-button size="small" @click="copyJson(jsonDialog.name)">复制 JSON</el-button>
      </div>
      <pre class="json-pre" v-html="highlightedJson"></pre>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { Loading } from "@element-plus/icons-vue";
import { api } from "@/api";
import { usePolling } from "@/composables/usePolling";
import EnlargableCard from "@/components/EnlargableCard.vue";
import { formatBytes } from "@/utils/format";
import { copyText } from "@/utils/clipboard";

interface ContainerStat {
  name: string;
  cpuPercent: number;
  memUsage: number;
  memLimit: number;
  memPercent: number;
  netIn: number;
  netOut: number;
  blockIn: number;
  blockOut: number;
}
interface Container {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
}
interface DockerInfo {
  available: boolean;
  containers: Container[];
  stats: ContainerStat[];
}

/** docker inspect 单个元素中前端会用到的字段（宽松类型，多余字段忽略） */
interface PortBinding {
  HostIp?: string;
  HostPort?: string;
}
interface InspectMount {
  Type?: string;
  Name?: string;
  Source?: string;
  Destination?: string;
  RW?: boolean;
}
interface InspectData {
  Id?: string;
  Name?: string;
  Created?: string;
  Path?: string;
  Args?: string[];
  Config?: {
    Image?: string;
    Env?: string[];
    Cmd?: string[];
    Entrypoint?: string[];
    WorkingDir?: string;
    User?: string;
  };
  HostConfig?: {
    PortBindings?: Record<string, PortBinding[]>;
    RestartPolicy?: { Name?: string; MaximumRetryCount?: number };
    NetworkMode?: string;
    Privileged?: boolean;
  };
  NetworkSettings?: {
    Ports?: Record<string, PortBinding[] | null>;
    Networks?: Record<string, { IPAddress?: string; Gateway?: string }>;
  };
  Mounts?: InspectMount[];
  State?: {
    Status?: string;
    Pid?: number;
    StartedAt?: string;
  };
}

const props = defineProps<{ host: string }>();
const busy = ref<string | null>(null);

const { data, error, loading, refresh } = usePolling<DockerInfo>(
  () => api.collectDocker(props.host) as Promise<DockerInfo>,
  5000,
  () => props.host
);

const statMap = computed(() => {
  const m = new Map<string, ContainerStat>();
  for (const s of data.value?.stats || []) m.set(s.name, s);
  return m;
});
function statOf(name: string) {
  return statMap.value.get(name);
}
function stateType(state: string) {
  if (state === "running") return "success";
  if (state === "paused" || state === "restarting") return "warning";
  if (state === "dead") return "danger";
  return "info";
}
async function act(name: string, action: "start" | "stop" | "restart") {
  busy.value = name;
  try {
    await api.dockerAction(props.host, action, name);
    ElMessage.success(`${action} 已提交`);
    // 状态变了，inspect 缓存作废，下次悬浮重新查
    delete detailMap[name];
    delete rawMap[name];
    pending.delete(name);
    await refresh();
  } catch (e) {
    ElMessage.error(`操作失败: ${e}`);
  } finally {
    busy.value = null;
  }
}

/** inspect 结果按容器名缓存；首次悬浮时查询一次 */
const detailMap = reactive<Record<string, InspectData | null>>({});
const rawMap = reactive<Record<string, string>>({});
const pending = new Set<string>();

function inspectOf(name: string): InspectData | null | undefined {
  if (detailMap[name] === undefined && !pending.has(name)) {
    pending.add(name);
    api
      .dockerInspect(props.host, name)
      .then((raw: string) => {
        rawMap[name] = raw;
        const arr = JSON.parse(raw);
        detailMap[name] = Array.isArray(arr) ? (arr[0] ?? null) : null;
      })
      .catch(() => (detailMap[name] = null));
  }
  return detailMap[name];
}

/** 悬浮卡片：贴容器卡片右侧，右侧放不下翻到左侧；可交互所以不能跟随鼠标 */
const card = reactive({ visible: false, name: "", x: 0, y: 0 });
const CARD_W = 420;
let hideTimer: number | undefined;

function onCardEnter(e: MouseEvent, c: Container) {
  cancelHide();
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const vw = window.innerWidth;
  let x = rect.right + 12;
  if (x + CARD_W > vw - 8) x = Math.max(8, rect.left - CARD_W - 12);
  card.x = x;
  card.y = Math.min(Math.max(8, rect.top), window.innerHeight - 160);
  card.name = c.name;
  card.visible = true;
  void inspectOf(c.name);
}
/** 延迟隐藏：给鼠标从容器卡片移到详情卡片留出时间 */
function scheduleHide() {
  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => (card.visible = false), 250);
}
function cancelHide() {
  clearTimeout(hideTimer);
}

// ---- inspect 字段格式化 ----

/** RFC3339 → 本地时间；0001-01-01 表示从未发生 */
function fmtTime(s?: string): string {
  if (!s || s.startsWith("0001-01-01")) return "—";
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleString();
}

/** 启动命令：Path + Args（docker inspect 顶层），缺省回退 Entrypoint + Cmd */
function cmdLine(d: InspectData): string {
  if (d.Path) return [d.Path, ...(d.Args || [])].join(" ");
  const cfg = d.Config;
  if (!cfg) return "";
  return [...(cfg.Entrypoint || []), ...(cfg.Cmd || [])].join(" ");
}

function restartPolicy(d: InspectData): string {
  const p = d.HostConfig?.RestartPolicy;
  if (!p?.Name) return "no（不重启）";
  if (p.Name === "on-failure" && p.MaximumRetryCount) {
    return `on-failure（最多 ${p.MaximumRetryCount} 次）`;
  }
  return p.Name;
}

/** 端口映射行："0.0.0.0:8080 → 80/tcp"；声明了但未映射的显示 "80/tcp（未映射）" */
function portLines(d: InspectData): string[] {
  const lines: string[] = [];
  const ports =
    d.HostConfig?.PortBindings && Object.keys(d.HostConfig.PortBindings).length
      ? d.HostConfig.PortBindings
      : d.NetworkSettings?.Ports;
  if (!ports) return lines;
  for (const [cport, binds] of Object.entries(ports)) {
    if (!binds || !binds.length) {
      lines.push(`${cport}（未映射）`);
      continue;
    }
    for (const b of binds) {
      lines.push(`${b.HostIp || "0.0.0.0"}:${b.HostPort} → ${cport}`);
    }
  }
  return lines;
}

/** 挂载行："bind  /host/path → /container/path（rw）"；volume 显示卷名 */
function mountLines(d: InspectData): string[] {
  return (d.Mounts || []).map((m) => {
    const src = m.Type === "volume" ? `卷 ${m.Name || m.Source || "?"}` : m.Source || "?";
    return `${m.Type || "?"}  ${src} → ${m.Destination || "?"}（${m.RW ? "rw" : "ro"}）`;
  });
}

function networkLines(d: InspectData): string[] {
  const nets = d.NetworkSettings?.Networks || {};
  return Object.entries(nets).map(([n, v]) => {
    if (v.IPAddress) return `${n}  ${v.IPAddress}${v.Gateway ? `（网关 ${v.Gateway}）` : ""}`;
    return `${n}（无 IP）`;
  });
}

// ---- inspect JSON 复制 / 查看 ----

const jsonDialog = reactive({ visible: false, name: "" });
function openJsonDialog(name: string) {
  jsonDialog.name = name;
  jsonDialog.visible = true;
}
function prettyJson(name: string): string {
  const raw = rawMap[name];
  if (!raw) return "";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
const jsonLineCount = computed(() => prettyJson(jsonDialog.name).split("\n").length);

/**
 * JSON 语法高亮：key / 字符串 / 数字 / true-false-null 各自着色。
 * 先整体 HTML 转义，再用单次全局正则交替匹配（替换结果不会被重新扫描，不会误伤 span 属性）。
 */
const highlightedJson = computed(() => {
  const json = prettyJson(jsonDialog.name);
  if (!json) return "";
  const html = json
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return html.replace(
    /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (m, str: string, colon: string, kw: string, num: string) => {
      if (str) {
        return colon
          ? `<span class="j-key">${str}</span>${colon}`
          : `<span class="j-str">${str}</span>`;
      }
      if (kw) return `<span class="j-kw">${kw}</span>`;
      if (num) return `<span class="j-num">${num}</span>`;
      return m;
    }
  );
});
async function copyJson(name: string) {
  const json = prettyJson(name);
  if (!json) {
    ElMessage.warning("inspect 数据尚未加载完成");
    return;
  }
  try {
    await copyText(json);
    ElMessage.success("inspect JSON 已复制，可直接粘贴给 AI 分析");
  } catch {
    ElMessage.error("复制失败");
  }
}
</script>

<style scoped>
.tab-root {
  height: 100%;
  min-height: 0;
  overflow: auto;
}
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.card {
  min-width: 0;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--el-text-color-secondary);
  flex-shrink: 0;
}
.dot.on {
  background: var(--el-color-success);
}
.name {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.image {
  font-size: 11px;
  margin-bottom: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  margin: 4px 0;
}
.status {
  margin-top: 8px;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.muted {
  color: var(--el-text-color-secondary);
}
.mono {
  font-variant-numeric: tabular-nums;
}
.full {
  grid-column: 1 / -1;
}
@media (max-width: 900px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
.dialog-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  font-size: 12px;
}
.json-pre {
  max-height: 82vh;
  overflow: auto;
  margin: 0;
  padding: 14px 16px;
  border-radius: 6px;
  background: var(--el-fill-color-light);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-all;
}
/* v-html 注入的高亮 span 不带 scoped 属性，需要 :deep 穿透 */
.json-pre :deep(.j-key) {
  color: var(--el-color-primary);
  font-weight: 600;
}
.json-pre :deep(.j-str) {
  color: var(--el-color-success);
}
.json-pre :deep(.j-num) {
  color: var(--el-color-warning);
}
.json-pre :deep(.j-kw) {
  color: var(--el-color-danger);
  font-style: italic;
}
</style>

<style>
/* 悬浮详情卡片（Teleport 到 body，scoped 不生效）；
   与 ServicesView 的卡片同风格，但可交互（有复制/查看按钮） */
.dc-hover-card {
  position: fixed;
  z-index: 3000;
  width: 420px;
  max-height: 80vh;
  overflow-y: auto;
  padding: 12px 14px;
  border-radius: 8px;
  background: var(--el-bg-color-overlay, #fff);
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
  font-size: 12px;
  color: var(--el-text-color-primary, #303133);
}
.dc-hover-card .detail-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.dc-hover-card .d-row {
  display: flex;
  gap: 12px;
  padding: 3px 0;
  line-height: 1.5;
}
.dc-hover-card .k {
  flex-shrink: 0;
  width: 62px;
  color: var(--el-text-color-secondary);
}
.dc-hover-card .v {
  flex: 1;
  min-width: 0;
  word-break: break-all;
}
.dc-hover-card .v.mono,
.dc-hover-card .lines.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
}
.dc-hover-card .section-title {
  margin: 10px 0 4px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
  border-top: 1px dashed var(--el-border-color-lighter);
  padding-top: 8px;
}
.dc-hover-card .lines > div {
  padding: 2px 0;
  word-break: break-all;
  line-height: 1.5;
}
.dc-hover-card .lines .muted {
  color: var(--el-text-color-secondary);
}
.dc-hover-card .card-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
  padding-top: 8px;
  border-top: 1px solid var(--el-border-color-lighter);
}
.dc-hover-card .detail-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
  padding: 16px 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
