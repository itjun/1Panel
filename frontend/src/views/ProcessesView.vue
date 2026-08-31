<template>
  <div class="tab-root tab-table-page" v-loading="view !== 'docker' && loading && !rows.length">
    <EnlargableCard title="进程">
    <!-- 三级视图标签：照搬 1Panel LayoutContent search 卡 + LogRouter tag-button -->
    <div class="view-toolbar">
      <div class="view-toolbar__chips">
        <TagButton v-model="view" :buttons="viewButtons" />
      </div>
      <div class="view-toolbar__tools">
          <el-input
            v-model="filter"
            clearable
            class="filter-input"
            :placeholder="filterPlaceholder"
          />
          <span class="count">{{ view === "docker" ? dockerFilteredCount : filtered.length }} 个</span>
          <el-button :icon="Refresh" @click="onRefresh" />
      </div>
    </div>
    <el-alert v-if="view !== 'docker' && error && !rows.length" type="error" :title="error" show-icon />

    <div ref="tableWrap" class="table-wrap m3-table-surface m3-table-v2">
      <!-- Docker：沿用原 Docker 标签页的卡片 + inspect 浮层 -->
      <DockerView
        v-if="view === 'docker'"
        ref="dockerViewRef"
        :host="host"
        :filter="filter"
        @update:count="dockerFilteredCount = $event"
      />

      <!-- 全部进程视图（虚拟化表格，只画可视区） -->
      <el-table-v2
        v-else-if="view === 'all' && size.width.value > 0"
        :columns="allColumns"
        :data="sortedRows"
        :width="size.width.value"
        :height="size.height.value"
        :row-height="M3_TABLE_ROW_HEIGHT"
        :header-height="M3_TABLE_HEADER_HEIGHT"
        :row-class="zebraRowClass"
        :sort-by="sortBy"
        :row-event-handlers="allRowEventHandlers"
        @column-sort="onColumnSort"
      >
        <template #empty>暂无数据</template>
      </el-table-v2>

      <!-- 运行时进程视图（java/go/node/bun/python，虚拟化 + 行悬浮详情卡） -->
      <el-table-v2
        v-else-if="view !== 'all' && size.width.value > 0"
        :columns="runtimeColumns"
        :data="sortedRows"
        :width="size.width.value"
        :height="size.height.value"
        :row-height="M3_TABLE_ROW_HEIGHT"
        :header-height="M3_TABLE_HEADER_HEIGHT"
        :row-class="zebraRowClass"
        :sort-by="sortBy"
        :row-event-handlers="rowEventHandlers"
        @column-sort="onColumnSort"
      >
        <template #empty>暂无数据</template>
      </el-table-v2>
    </div>

    <el-empty
      v-if="view !== 'all' && view !== 'docker' && !loading && rows.length === 0 && !error"
      :description="`未发现运行中的 ${viewLabel} 进程`"
    />
    </EnlargableCard>

    <!-- 跟随鼠标的详情卡片：固定定位 + 视口内自动避让；
         悬浮时不参与鼠标事件，点击行固定（pinned）后可交互、可选择文本、可复制 -->
    <Teleport to="body">
      <div
        v-if="card.visible && card.proc && view !== 'docker'"
        class="java-hover-card"
        :class="{ pinned: card.pinned }"
        :style="{ left: card.x + 'px', top: card.y + 'px' }"
      >
        <div class="detail-title">
          {{ card.proc.entry ? baseName(card.proc.entry) : appName(card.proc) }}
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
          <template v-if="view !== 'all'">
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
              <span class="k">{{ view === "java" ? "jar 包" : "入口" }}</span>
              <span class="v mono break">{{ entryText(card.proc) }}</span>
            </div>
            <div class="d-row">
              <span class="k">监听端口</span>
              <span class="v mono">{{ (card.proc.ports || []).join("、") || "—" }}</span>
            </div>
          </template>
          <div class="d-row">
            <span class="k">CPU / 内存</span>
            <span class="v mono">
              {{ Number(card.proc.cpu || 0).toFixed(2) }}% /
              {{ formatBytes(card.proc.rss || 0) }}（{{ Number(card.proc.mem || 0).toFixed(1) }}%）
            </span>
          </div>
          <div class="d-row" v-if="view === 'java'">
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
            <span class="v">{{ formatDurationLong(card.proc.elapsed || 0) }}</span>
          </div>
          <template v-if="detailOf(card.proc.pid)">
            <div class="d-row">
              <span class="k">工作目录</span>
              <span class="v mono break">{{ detailOf(card.proc.pid)?.workDir || "—（无权限）" }}</span>
            </div>
            <div class="d-row">
              <span class="k">可执行路径</span>
              <span class="v mono break">{{ detailOf(card.proc.pid)?.exePath || "—（无权限）" }}</span>
            </div>
            <div class="d-row">
              <span class="k">磁盘 IO</span>
              <span class="v mono">
                <template v-if="detailOf(card.proc.pid)?.readBytes || detailOf(card.proc.pid)?.writeBytes">
                  读 {{ formatBytes(detailOf(card.proc.pid)!.readBytes) }}
                  / 写 {{ formatBytes(detailOf(card.proc.pid)!.writeBytes) }}（累计）
                </template>
                <template v-else>—（无 /proc/io 读取权限）</template>
              </span>
            </div>
          </template>
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
import { computed, h, reactive, ref, watch } from "vue";
import {
  ElButton,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElMessage,
  ElMessageBox,
  ElTag,
  TableV2SortOrder,
  TableV2FixedDir,
} from "element-plus";
import type {
  Column,
  ColumnSortParams,
  RowEventHandlers,
  SortBy,
} from "element-plus";
import { Refresh } from "@element-plus/icons-vue";
import { api } from "@/api";
import type { RuntimeCounts } from "@/api";
import { usePolling } from "@/composables/usePolling";
import { useContainerSize } from "@/composables/useContainerSize";
import EnlargableCard from "@/components/EnlargableCard.vue";
import TagButton from "@/components/TagButton.vue";
import DockerView from "@/views/DockerView.vue";
import { copyText } from "@/utils/clipboard";
import { formatBytes, formatDurationCompact, formatDurationLong } from "@/utils/format";
import {
  M3_TABLE_HEADER_HEIGHT,
  M3_TABLE_ROW_HEIGHT,
  zebraRowClass,
} from "@/constants/m3Table";

interface ProcInfo {
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  rss: number;
  elapsed: number;
  cmd: string;
}
/** 运行时进程视图（含部署方式/入口/端口等，由 collectRuntimeProcs 返回）
 *  entry：java=jar 路径；node/bun/python=脚本路径；go=可执行文件路径
 *  xms/xmx 仅 java 有值 */
interface RuntimeProc {
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  rss: number;
  elapsed: number;
  args: string;
  entry: string;
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

/** 运行时视图定义（与后端 runtimeCommFilter 对应）；顺序即标签展示顺序 */
const RUNTIME_TABS = [
  { value: "java", label: "Java" },
  { value: "bun", label: "Bun" },
  { value: "python", label: "Python" },
  { value: "node", label: "Node" },
  { value: "go", label: "Go" },
] as const;
type RuntimeView = (typeof RUNTIME_TABS)[number]["value"];

type ViewKind = "all" | RuntimeView | "docker";
const view = ref<ViewKind>("all");
const viewLabel = computed(() => {
  if (view.value === "docker") return "Docker";
  return RUNTIME_TABS.find((t) => t.value === view.value)?.label || "";
});
const filter = ref("");
const dockerFilteredCount = ref(0);
const dockerViewRef = ref<{ refresh: () => Promise<void> } | null>(null);

const { data, error, loading, refresh } = usePolling<ProcInfo[] | RuntimeProc[]>(
  () => {
    if (view.value === "docker") return Promise.resolve([]);
    if (view.value === "all") {
      return api.collectProcesses(props.host, 100) as Promise<ProcInfo[]>;
    }
    return api.collectRuntimeProcs(props.host, view.value) as Promise<RuntimeProc[]>;
  },
  5000,
  () => [props.host, view.value]
);

function onRefresh() {
  if (view.value === "docker") {
    void dockerViewRef.value?.refresh();
    return;
  }
  void refresh();
}

/** 运行时视图下表格行就是 RuntimeProc；all 视图的行不含扩展字段 */
const rows = computed(() => data.value || []);

/** 各运行时正在运行的进程数（标签徽标，慢速轮询；go 识别需扫描 /proc 稍重） */
const { data: runtimeCounts } = usePolling<RuntimeCounts>(
  () => api.collectRuntimeCounts(props.host) as Promise<RuntimeCounts>,
  30000,
  () => [props.host]
);

/** 标签按钮：全部进程 + 各运行时 + Docker（带数量徽标） */
const viewButtons = computed(() => [
  { value: "all", label: "全部进程" },
  ...RUNTIME_TABS.map((t) => ({
    ...t,
    // 当前选中的运行时优先用列表行数（随 5s 轮询实时更新）；
    // 列表加载中/失败时回退计数接口，避免徽标闪 0 或空白
    count:
      view.value === t.value
        ? rows.value.length || runtimeCounts.value?.[t.value]
        : runtimeCounts.value?.[t.value],
  })),
  {
    value: "docker",
    label: "Docker",
    count:
      view.value === "docker"
        ? dockerFilteredCount.value || runtimeCounts.value?.docker
        : runtimeCounts.value?.docker,
  },
]);
const filterPlaceholder = computed(() => {
  if (view.value === "all") return "按命令/用户/PID 过滤...";
  if (view.value === "docker") return "按名称/镜像/状态/端口过滤...";
  return "按入口/命令/用户/PID 过滤...";
});
const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase();
  if (!q) return rows.value;
  return rows.value.filter((p) => {
    const cmd = view.value === "all" ? (p as ProcInfo).cmd : (p as RuntimeProc).args;
    const entry = (p as RuntimeProc).entry || "";
    return (
      cmd.toLowerCase().includes(q) ||
      entry.toLowerCase().includes(q) ||
      (p.user || "").toLowerCase().includes(q) ||
      String(p.pid).includes(q)
    );
  });
});

/* ---------- 虚拟化表格（el-table-v2）：容器尺寸 + 列定义 + 排序 ---------- */

const tableWrap = ref<HTMLDivElement | null>(null);
const size = useContainerSize(tableWrap);

/** 超长文本单元格：单行截断。width/minWidth 必须写死，flex 单元格默认 min-width:auto 会把整段命令撑出来换行 */
const ELLIPSIS_STYLE: Record<string, string> = {
  display: "block",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  minWidth: "0",
  width: "100%",
  lineHeight: "22px",
};
const ellipsisCell = (text: string, cls = "", title?: string) =>
  h(
    "span",
    {
      class: ["cell-ellipsis", cls],
      style: ELLIPSIS_STYLE,
      title: title || text || "",
    },
    text || ""
  );

const elapsedCell = ({ cellData }: { cellData: number }) =>
  ellipsisCell(
    formatDurationCompact(cellData || 0),
    "mono",
    formatDurationLong(cellData || 0)
  );

const cpuCell = ({ cellData }: { cellData: number }) =>
  h("span", { class: cpuClass(cellData) }, Number(cellData || 0).toFixed(1));

const memCell = ({ cellData }: { cellData: number }) =>
  h("span", { class: cellData > 50 ? "warn" : "" }, Number(cellData || 0).toFixed(1));

const bytesCell = ({ cellData }: { cellData: number }) =>
  h("span", { class: "mono" }, formatBytes(cellData || 0));

/** java 视图的堆内存单元格：Xms~Xmx，未设置的一侧显示「默认」 */
function heapCell({ rowData }: { rowData: RuntimeProc }) {
  if (!rowData.xms && !rowData.xmx) {
    return h("span", { class: "dim" }, "—");
  }
  const xms = rowData.xms ? formatBytes(rowData.xms) : "默认";
  const xmx = rowData.xmx ? formatBytes(rowData.xmx) : "默认";
  return h("span", { class: "mono" }, `${xms}~${xmx}`);
}

/** 操作列：复制命令 / TERM / KILL（两个视图仅文案与取命令字段不同） */
function actionCell(copyLabel: string, getCmd: (row: ProcInfo | RuntimeProc) => string) {
  return ({ rowData }: { rowData: ProcInfo | RuntimeProc }) =>
    h(
      ElDropdown,
      { trigger: "click", class: "proc-actions" },
      {
        default: () =>
          h(
            ElButton,
            {
              size: "small",
              text: true,
              // 拦住冒泡：否则行 onClick 会把详情卡钉住，和菜单叠在一起
              onClick: (e: MouseEvent) => {
                e.stopPropagation();
                hideProcCard();
              },
            },
            () => "⋯"
          ),
        dropdown: () =>
          h(ElDropdownMenu, () => [
            h(
              ElDropdownItem,
              { onClick: () => copyCmd(getCmd(rowData)) },
              () => copyLabel
            ),
            h(
              ElDropdownItem,
              { divided: true, onClick: () => kill(rowData.pid, getCmd(rowData), false) },
              () => "结束进程 (TERM)"
            ),
            h(
              ElDropdownItem,
              { onClick: () => kill(rowData.pid, getCmd(rowData), true) },
              () => "强制结束 (KILL)"
            ),
          ]),
      }
    );
}

/** 全部进程视图列 */
const allColumns: Column<any>[] = [
  { key: "pid", dataKey: "pid", title: "PID", width: 80 },
  { key: "user", dataKey: "user", title: "用户", width: 90 },
  { key: "cpu", dataKey: "cpu", title: "CPU%", width: 80, sortable: true, cellRenderer: cpuCell },
  { key: "mem", dataKey: "mem", title: "MEM%", width: 80, cellRenderer: memCell },
  { key: "rss", dataKey: "rss", title: "RSS", width: 90, cellRenderer: bytesCell },
  {
    key: "elapsed",
    dataKey: "elapsed",
    title: "运行时长",
    width: 110,
    flexShrink: 0,
    cellRenderer: elapsedCell,
  },
  {
    key: "cmd",
    dataKey: "cmd",
    title: "启动命令",
    width: 300,
    minWidth: 160,
    flexGrow: 1,
    flexShrink: 1,
    cellRenderer: ({ cellData }: { cellData: string }) => ellipsisCell(cellData),
  },
  {
    key: "actions",
    title: "操作",
    width: 72,
    align: "right" as const,
    fixed: TableV2FixedDir.RIGHT,
    cellRenderer: actionCell("复制启动命令", (r) => (r as ProcInfo).cmd || ""),
  },
];

/** 运行时视图列（java 多一列堆内存） */
const runtimeColumns = computed((): Column<any>[] => [
  { key: "pid", dataKey: "pid", title: "PID", width: 80 },
  {
    key: "user",
    dataKey: "user",
    title: "用户",
    width: 90,
    cellRenderer: ({ cellData }: { cellData: string }) => ellipsisCell(cellData),
  },
  {
    key: "deploy",
    dataKey: "deploy",
    title: "部署方式",
    width: 100,
    cellRenderer: ({ rowData }: { rowData: RuntimeProc }) =>
      h(
        ElTag,
        { size: "small", type: deployTagType(rowData.deploy) },
        () => deployLabel(rowData)
      ),
  },
  {
    key: "entry",
    title: "应用",
    width: 220,
    flexGrow: 1,
    flexShrink: 1,
    cellRenderer: ({ rowData }: { rowData: RuntimeProc }) =>
      ellipsisCell(displayName(rowData)),
  },
  {
    key: "ports",
    title: "端口",
    width: 130,
    cellRenderer: ({ rowData }: { rowData: RuntimeProc }) =>
      ellipsisCell((rowData.ports || []).join(" ") || "—", "mono"),
  },
  { key: "cpu", dataKey: "cpu", title: "CPU%", width: 80, sortable: true, cellRenderer: cpuCell },
  { key: "rss", dataKey: "rss", title: "内存", width: 90, cellRenderer: bytesCell },
  ...(view.value === "java"
    ? [
        {
          key: "heap",
          title: "堆内存 (Xms~Xmx)",
          width: 150,
          cellRenderer: heapCell,
        },
      ]
    : []),
  {
    key: "elapsed",
    dataKey: "elapsed",
    title: "运行时长",
    width: 110,
    flexShrink: 0,
    cellRenderer: elapsedCell,
  },
  {
    key: "args",
    dataKey: "args",
    title: "启动命令",
    width: 280,
    minWidth: 160,
    flexGrow: 1,
    flexShrink: 1,
    cellRenderer: ({ cellData }: { cellData: string }) => ellipsisCell(cellData),
  },
  {
    key: "actions",
    title: "操作",
    width: 72,
    align: "right" as const,
    fixed: TableV2FixedDir.RIGHT,
    cellRenderer: actionCell("复制命令行", (r) => (r as RuntimeProc).args || ""),
  },
]);

/** CPU 排序状态（原 sort-method 迁移为 computed 排序） */
const sortBy = ref<SortBy>({ key: "", order: TableV2SortOrder.ASC });
function onColumnSort(by: ColumnSortParams<any>) {
  sortBy.value = { key: by.key, order: by.order };
}
const sortedRows = computed(() => {
  if (sortBy.value.key !== "cpu") return filtered.value;
  const dir = sortBy.value.order === TableV2SortOrder.DESC ? -1 : 1;
  return [...filtered.value].sort((a, b) => dir * ((a.cpu || 0) - (b.cpu || 0)));
});

/** 全部进程行：补齐卡片所需字段，命令放在 args 里 */
function procAsCard(p: ProcInfo): RuntimeProc {
  return {
    pid: p.pid,
    user: p.user,
    cpu: p.cpu,
    mem: p.mem,
    rss: p.rss,
    elapsed: p.elapsed,
    args: p.cmd,
    entry: "",
    xms: 0,
    xmx: 0,
    ports: [],
    deploy: "",
    service: "",
    container: "",
    image: "",
  };
}

/** 运行时视图行事件：悬浮详情卡 + 点击固定（对应原 cell-mouse-* / cell-click） */
const rowEventHandlers: RowEventHandlers = {
  onMouseenter: ({ rowData, event }) =>
    onRowEnter(rowData as RuntimeProc, event as MouseEvent),
  onMouseleave: () => scheduleHide(),
  onClick: ({ rowData, event }) =>
    onCellClick(rowData as RuntimeProc, event as MouseEvent),
};

const allRowEventHandlers: RowEventHandlers = {
  onMouseenter: ({ rowData, event }) =>
    onRowEnter(procAsCard(rowData as ProcInfo), event as MouseEvent),
  onMouseleave: () => scheduleHide(),
  onClick: ({ rowData, event }) =>
    onCellClick(procAsCard(rowData as ProcInfo), event as MouseEvent),
};

function isActionEvent(e: MouseEvent) {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return !!t.closest(".proc-actions, .el-dropdown, .el-dropdown-menu, .el-button");
}

/** 切换视图时收起详情卡片（固定中的也一并取消）并重置排序 */
watch(view, () => {
  clearTimeout(hideTimer);
  card.visible = false;
  card.pinned = false;
  sortBy.value = { key: "", order: TableV2SortOrder.ASC };
});

function cpuClass(cpu: number) {
  if (cpu > 80) return "danger";
  if (cpu > 30) return "warn";
  return "";
}
async function copyCmd(cmd: string) {
  const text = (cmd || "").trim();
  if (!text) {
    ElMessage.warning("启动命令为空");
    return;
  }
  try {
    await copyText(text);
    ElMessage.success("启动命令已复制到剪贴板");
  } catch (e) {
    ElMessage.error(`复制失败: ${e}`);
  }
}
async function kill(pid: number, cmd: string, force: boolean) {
  // 二次确认：普通/强制结束都弹窗，防止误操作
  try {
    await ElMessageBox.confirm(
      `确定要${force ? "强制结束（SIGKILL）" : "结束（SIGTERM）"}进程 ${pid} 吗？\n${
        (cmd || "").slice(0, 120)
      }`,
      force ? "强制结束进程" : "结束进程",
      {
        type: "warning",
        confirmButtonText: force ? "强制结束" : "结束进程",
        cancelButtonText: "取消",
        confirmButtonClass: "el-button--danger",
      }
    );
  } catch {
    return;
  }
  try {
    await api.killProcess(props.host, pid, force);
    ElMessage.success("已发送信号");
    await refresh();
  } catch (e) {
    ElMessage.error(`结束失败: ${e}`);
  }
}

/* ---------- 运行时进程详情卡片（原 Java 标签页迁入后泛化） ---------- */

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
  proc: null as RuntimeProc | null,
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
function onRowEnter(row: RuntimeProc, e: MouseEvent) {
  if (card.pinned) return; // 固定期间不跟随不切换
  if (isActionEvent(e)) return;
  clearTimeout(hideTimer);
  card.proc = row;
  placeCard(e);
  card.visible = true;
  void detailOf(row.pid);
}
/** 行间移动会连续触发 mouseleave，延迟隐藏避免闪烁 */
function scheduleHide() {
  if (card.pinned) return;
  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => (card.visible = false), 200);
}
/** 点击行：固定卡片（再点同一行取消固定，点其他行切换固定目标） */
function onCellClick(row: RuntimeProc, e: MouseEvent) {
  if (isActionEvent(e)) return;
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
function hideProcCard() {
  clearTimeout(hideTimer);
  card.pinned = false;
  card.visible = false;
}
function unpin() {
  hideProcCard();
}

/** 运行时视图列展示辅助 */
function deployLabel(p: RuntimeProc): string {
  if (p.deploy === "systemd") return "systemd";
  if (p.deploy === "docker") return "Docker";
  return "直跑";
}
function deployTagType(deploy: string): "primary" | "success" | "info" {
  if (deploy === "docker") return "primary";
  if (deploy === "systemd") return "success";
  return "info";
}
function displayName(p: RuntimeProc): string {
  return p.entry ? baseName(p.entry) : appName(p);
}
function baseName(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}
/** 入口为空时的兜底展示：java 取主类名（-cp 后的词），
 *  其它运行时取最后一个非选项参数 */
function appName(p: RuntimeProc): string {
  const fields = (p.args || "").split(/\s+/);
  for (let i = 0; i < fields.length; i++) {
    if (fields[i] === "-cp" || fields[i] === "-classpath") {
      if (fields[i + 2]) return fields[i + 2];
      const jars = (fields[i + 1] || "").split(":").filter((x) => x.endsWith(".jar"));
      if (jars.length) return baseName(jars[0]);
    }
  }
  for (let i = fields.length - 1; i >= 0; i--) {
    if (fields[i] && !fields[i].startsWith("-") && !INTERPRETERS.has(fields[i])) {
      return fields[i];
    }
  }
  return viewLabel.value.toLowerCase() || "process";
}
/** 命令行里的解释器名（appName 兜底时跳过） */
const INTERPRETERS = new Set([
  "java",
  "node",
  "nodejs",
  "bun",
  "python",
  "python3",
]);
/** 卡片「入口」行文案：java 无 jar 与其它运行时无入口时的占位不同 */
function entryText(p: RuntimeProc): string {
  if (p.entry) return p.entry;
  return view.value === "java" ? "—（非 jar 启动）" : "—";
}

/** 复制固定卡片的完整进程信息（格式化文本，方便直接贴给 AI 分析） */
async function copyProcInfo() {
  const p = card.proc;
  if (!p) return;
  const d = detailOf(p.pid);
  const isJava = view.value === "java";
  const lines = [
    `=== ${viewLabel.value} 进程信息（PID ${p.pid}）===`,
    `用户: ${p.user || "—"}`,
    `部署方式: ${deployLabel(p)}${p.service ? `（${p.service}）` : ""}${p.container ? `（容器 ${p.container}，镜像 ${p.image || "未知"}）` : ""}`,
    `${isJava ? "jar 包" : "入口"}: ${entryText(p)}`,
    `监听端口: ${(p.ports || []).join("、") || "—"}`,
    `CPU: ${Number(p.cpu || 0).toFixed(2)}%`,
    `内存 RSS: ${formatBytes(p.rss || 0)}（${Number(p.mem || 0).toFixed(1)}%）`,
  ];
  if (isJava) {
    lines.push(
      `堆内存: ${p.xms || p.xmx ? `${p.xms ? formatBytes(p.xms) : "默认"} ~ ${p.xmx ? formatBytes(p.xmx) : "默认"}（Xms ~ Xmx）` : "未显式设置 -Xms/-Xmx"}`
    );
  }
  lines.push(
    `已运行: ${formatDurationLong(p.elapsed || 0)}`,
    `工作目录: ${d?.workDir || "—（无权限）"}`,
    `可执行路径: ${d?.exePath || "—（无权限）"}`,
    `磁盘 IO(累计): ${d?.readBytes || d?.writeBytes ? `读 ${formatBytes(d.readBytes)} / 写 ${formatBytes(d.writeBytes)}` : "—（无 /proc/io 读取权限）"}`,
    `命令行: ${p.args || "—"}`
  );
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
</script>

<style scoped>
.tab-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: 8px;
}
/* 三级标签卡：照搬 1Panel LayoutContent content-container__search（--el-card-padding: 8px 12px） */
.filter {
  width: 240px;
}
.count {
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
.table-wrap > :deep(.tab-root) {
  flex: 1;
  min-height: 0;
}
/* 虚拟化表格：行高固定 34px，超长命令必须裁切，不能换行叠到下一行 */
.cell-ellipsis {
  display: block;
  min-width: 0;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 22px;
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
  padding: 16px;
  border-radius: var(--m3-shape-m, 12px);
  background: var(--m3-surface-container-lowest, #ecebf0);
  border: 1px solid var(--m3-outline-variant, #cac4d0);
  box-shadow: var(--m3-elevation-2);
  font: var(--m3-body-small);
  color: var(--m3-on-surface, #1a1a1d);
  pointer-events: none;
}
.java-hover-card.pinned {
  pointer-events: auto;
  z-index: 3001;
  border-color: var(--m3-primary);
  box-shadow: var(--m3-elevation-3);
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
.java-hover-card .detail-rows {
  display: flex;
  flex-direction: column;
}
.java-hover-card .d-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 4px 0;
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
  overflow-wrap: anywhere;
  word-break: break-word;
}
.java-hover-card .v.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
}
</style>
