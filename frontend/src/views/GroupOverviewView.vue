<template>
  <div
    class="group-overview"
    :class="{ 'is-drop-target': dropTargetId === groupId }"
    :data-drop-group="groupId"
  >
    <ChromeTeleport :when="app.isGroupVisible(groupId)" to="center">
      <el-segmented v-model="viewMode" :options="viewModeOptions" />
    </ChromeTeleport>
    <ChromeTeleport :when="app.isGroupVisible(groupId)">
      <el-button
        :loading="boardOpening"
        v-tip="'独立窗口全屏看板：可拖到外屏投屏'"
        @click="openBoardWindow"
      >
        弹出看板
      </el-button>
      <el-button
        :loading="batchBusy"
        :disabled="!hosts.length || agentInstall.running"
        v-tip="'为本组全部主机安装 Agent'"
        @click="batchInstallAgent"
      >
        安装 Agent
      </el-button>
      <el-button
        :icon="Refresh"
        :loading="refreshing"
        v-tip="'刷新'"
        @click="refreshAll"
      />
      <el-button
        v-if="viewMode === 'table' && colWidths"
        :icon="ScaleToOriginal"
        v-tip="'恢复默认列宽'"
        @click="resetColWidths"
      />
      <el-button
        v-if="canEditGroup"
        :icon="Setting"
        v-tip="'分组设置'"
        @click="openGroupSettings"
      />
    </ChromeTeleport>
    <template v-if="hosts.length">
      <div v-if="viewMode === 'table'" class="host-list-wrap">
        <el-table
          ref="hostTableRef"
          :data="hosts"
          size="default"
          border
          class="host-list-table data-table-unified"
          :row-class-name="tableRowClass"
          @row-dblclick="(row: sshconfig.HostConfig) => openHost(row.name)"
          @mousedown.capture="onHeaderResizeDown"
          @dblclick="onHeaderDblClick"
        >
          <el-table-column
            type="index"
            label="序"
            :width="colWidth('index') ?? DEFAULT_W.index"
            fixed
            align="center"
            class-name="group-index-col"
          />
          <el-table-column
            label="主机"
            :width="colWidth('host') ?? DEFAULT_W.host"
            fixed
            show-overflow-tooltip
          >
            <template #default="{ row }">
              <div class="list-host-name">
                <span class="list-os-ico">
                  <el-icon
                    v-if="hostState(row.name).error"
                    :size="18"
                    color="#b3261e"
                    v-tip="withErrTime(hostState(row.name).error!, hostState(row.name).errorAt)"
                  >
                    <WarningFilled />
                  </el-icon>
                  <DistroLogo
                    v-else
                    :os-release="hostState(row.name).overview?.osRelease || ''"
                    :size="16"
                    badge
                  />
                </span>
                <span class="list-host-label">{{ row.name }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column
            label="地址"
            :width="colWidth('addr') ?? DEFAULT_W.addr"
            show-overflow-tooltip
          >
            <template #default="{ row }">
              <span class="mono">{{ row.hostName || "—" }}</span>
            </template>
          </el-table-column>
          <el-table-column
            label="Agent"
            :width="colWidth('agent') ?? DEFAULT_W.agent"
            show-overflow-tooltip
          >
            <template #default="{ row }">
              <div v-if="batchProgressOf(row.name)" class="agent-progress-cell">
                <span
                  class="agent-progress-text"
                  :class="'is-' + batchProgressOf(row.name)!.state"
                >
                  {{ batchProgressLabel(row.name) }}
                </span>
                <el-progress
                  v-if="
                    batchProgressOf(row.name)!.state === 'running' &&
                    batchProgressOf(row.name)!.percent >= 0
                  "
                  :percentage="batchProgressOf(row.name)!.percent"
                  :stroke-width="4"
                  :show-text="false"
                />
              </div>
              <el-tag
                v-else
                size="small"
                round
                effect="light"
                :type="agentTagOf(row.name).type as any"
                class="group-status-chip"
              >
                {{ agentTagOf(row.name).text }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column
            label="用户"
            :width="colWidth('user') ?? DEFAULT_W.user"
            show-overflow-tooltip
          >
            <template #default="{ row }">
              {{ row.user || "—" }}
            </template>
          </el-table-column>
          <el-table-column
            label="版本"
            :width="colWidth('version') ?? DEFAULT_W.version"
            show-overflow-tooltip
          >
            <template #default="{ row }">
              <template v-if="hostState(row.name).error">—</template>
              <span v-else class="mono">{{
                osVersion(hostState(row.name).overview?.osRelease || "") || "—"
              }}</span>
            </template>
          </el-table-column>
          <el-table-column
            label="规格"
            :width="colWidth('spec') ?? DEFAULT_W.spec"
            show-overflow-tooltip
          >
            <template #default="{ row }">
              <el-skeleton
                v-if="hostState(row.name).loading && !hostState(row.name).overview"
                :rows="1"
                animated
                style="width: 80%"
              >
                <template #template>
                  <el-skeleton-item variant="text" style="width: 100%" />
                </template>
              </el-skeleton>
              <template v-else-if="hostState(row.name).error || !hostState(row.name).overview"
                >—</template
              >
              <span v-else class="mono">{{ hostSpec(hostState(row.name).overview!) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="CPU" :width="colWidth('cpu') ?? DEFAULT_W.cpu">
            <template #default="{ row }">
              <MetricCell
                :snap="hostState(row.name)"
                field="cpuPercent"
                :percent="true"
                :alert-threshold="THRESHOLDS.cpu"
                suffix="%"
              />
            </template>
          </el-table-column>
          <el-table-column label="内存" :width="colWidth('mem') ?? DEFAULT_W.mem">
            <template #default="{ row }">
              <MetricCell
                :snap="hostState(row.name)"
                field="memPercent"
                :percent="true"
                :alert-threshold="THRESHOLDS.mem"
                :alert-op="'gt'"
                suffix="%"
              />
            </template>
          </el-table-column>
          <el-table-column label="磁盘" :width="colWidth('disk') ?? DEFAULT_W.disk">
            <template #default="{ row }">
              <MetricCell
                :snap="hostState(row.name)"
                field="diskPercent"
                :percent="true"
                :disks="hostState(row.name).disks"
                suffix="%"
              />
            </template>
          </el-table-column>
          <el-table-column
            label="负载"
            :width="colWidth('load') ?? DEFAULT_W.load"
            align="right"
          >
            <template #default="{ row }">
              <el-skeleton
                v-if="hostState(row.name).loading && !hostState(row.name).overview"
                :rows="1"
                animated
                style="width: 80%"
              >
                <template #template><el-skeleton-item variant="text" style="width: 100%" /></template>
              </el-skeleton>
              <template v-else-if="!hostState(row.name).overview">—</template>
              <span
                v-else
                class="load-cell"
                :class="{ 'is-alert': isLoadAlert(hostState(row.name).overview!) }"
              >
                <span class="mono">{{ (hostState(row.name).overview!.load1 || 0).toFixed(2) }}</span>
                <span class="load-sep">/</span>
                <span class="load-cores">{{ hostState(row.name).overview!.cpuCount || 0 }}</span>
              </span>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div v-else class="board-embed-wrap">
        <BoardModeOverlay
          embedded
          :group-name="groupName"
          :board-title="boardTitle"
          :hosts="hosts"
          :cards="boardCards"
          @open-host="openHost"
        />
      </div>
    </template>

    <div v-else class="group-empty">
      <p class="group-empty__title">拖主机进来</p>
      <p class="group-empty__hint">
        从侧栏或其它分组把主机拖到本页，或点击下方添加
      </p>
      <el-button type="primary" @click="openAddHost">添加主机</el-button>
    </div>

    <!-- 批量安装进度：各主机步骤实时更新 -->
    <el-dialog
      v-model="batchDialogVisible"
      title="安装 Agent"
      width="560px"
      append-to-body
      :close-on-click-modal="false"
      :close-on-press-escape="batchDone"
      :show-close="batchDone"
      class="agent-batch-dialog"
      @closed="onBatchDialogClosed"
    >
      <p v-if="batchRows.length" class="batch-summary">
        {{ batchSummaryText }}
      </p>
      <div class="batch-progress-list">
        <div
          v-for="r in batchRows"
          :key="r.host"
          class="batch-progress-row"
          :class="'is-' + r.state"
        >
          <div class="batch-status-icon" aria-hidden="true">
            <el-icon v-if="r.state === 'running'" class="is-loading">
              <Loading />
            </el-icon>
            <el-icon v-else-if="r.state === 'done'">
              <CircleCheck />
            </el-icon>
            <el-icon v-else-if="r.state === 'error'">
              <CircleClose />
            </el-icon>
            <el-icon v-else>
              <Clock />
            </el-icon>
          </div>
          <div class="batch-row-body">
            <div class="batch-row-head">
              <span class="batch-host mono">{{ r.host }}</span>
              <span class="batch-label" :class="'is-' + r.state">{{ batchRowLabel(r) }}</span>
            </div>
            <el-progress
              v-if="r.state === 'running' && r.percent >= 0"
              :percentage="r.percent"
              :stroke-width="4"
              :show-text="false"
              class="batch-upload-bar"
            />
          </div>
        </div>
      </div>
      <template #footer>
        <p v-if="!batchDone" class="batch-running-hint">
          正在安装，请稍候…（全部主机并行）
        </p>
        <el-button
          v-else
          type="primary"
          class="batch-done-btn"
          @click="batchDialogVisible = false"
        >
          完成
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="groupSettingsOpen"
      title="分组设置"
      width="420px"
      append-to-body
      destroy-on-close
      class="m3-form-dialog"
      @opened="onGroupSettingsOpened"
    >
      <el-form label-position="top" @submit.prevent="saveGroupSettings">
        <el-form-item label="分组名称" required>
          <el-input
            ref="groupNameInputRef"
            v-model="settingsName"
            placeholder="侧栏与概览显示名"
            @keyup.enter="saveGroupSettings"
          />
        </el-form-item>
        <el-form-item label="看板标题">
          <el-input
            v-model="settingsBoardTitle"
            placeholder="看板正中标题，可空"
            @keyup.enter="saveGroupSettings"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="groupSettingsOpen = false">取消</el-button>
        <el-button
          type="primary"
          :loading="groupSettingsSaving"
          @click="saveGroupSettings"
        >
          保存
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  defineComponent,
  h,
  nextTick,
  onBeforeUnmount,
  ref,
  watch,
} from "vue";
import {
  CircleCheck,
  CircleClose,
  Clock,
  Loading,
  Refresh,
  ScaleToOriginal,
  Setting,
  WarningFilled,
} from "@element-plus/icons-vue";
import {
  ElMessage,
  ElMessageBox,
  ElNotification,
  ElProgress,
  ElSkeleton,
  ElSkeletonItem,
} from "element-plus";
import ChromeTeleport from "@/components/ChromeTeleport.vue";
import DistroLogo from "@/components/DistroLogo.vue";
import BoardModeOverlay, {
  type BoardHostCard,
} from "@/components/board/BoardModeOverlay.vue";
import { api } from "@/api";
import { Events } from "@wailsio/runtime";
import { useAppStore, UNGROUPED_ID } from "@/stores/app";
import { useAgentInstallStore } from "@/stores/agentInstall";
import { useInjectedHostDrag } from "@/composables/useHostDrag";
import {
  clearHostWecom,
  fireHostWecom,
  hostWecomKindFromKey,
  shouldToastHostAlert,
} from "@/utils/wecomHostAlerts";
import {
  formatBytes,
  formatErr,
  formatMemCapacity,
  isAgentMissing,
  isAgentNoSample,
} from "@/utils/format";
import {
  ALERT,
  diskLowMessage,
  isCpuAlert,
  isDiskLow,
  isLoadAlert,
  isMemAlert,
  summarizeDisks,
} from "@/utils/alerts";
import type { agentcli, monitor, sshconfig } from "@/api";

const VIEW_MODE_KEY = "1pannel-group-view-mode";
type GroupViewMode = "table" | "board";

function readViewMode(): GroupViewMode {
  try {
    const v = localStorage.getItem(VIEW_MODE_KEY);
    if (v === "board") return "board";
  } catch {
    /* 忽略 */
  }
  return "table";
}

const props = defineProps<{
  groupId: string;
  groupName: string;
}>();

const app = useAppStore();
const agentInstall = useAgentInstallStore();
const {
  dropTargetId,
} = useInjectedHostDrag();

const viewMode = ref<GroupViewMode>(readViewMode());
const viewModeOptions = [
  { label: "表格", value: "table" },
  { label: "看板", value: "board" },
];

watch(viewMode, (m) => {
  try {
    localStorage.setItem(VIEW_MODE_KEY, m);
  } catch {
    /* 忽略 */
  }
  if (m === "table") nextTick(scheduleAutoWidths);
});

// ---------- 列宽：可拖拽 / 双击分界线自适应 / 持久化 ----------

// v3：只存用户拖过/双击过的列；v2 存过被 realWidth 污染的全量快照，作废
// v4：v3 期间 WebKit 把进度条量出虚大宽度被双击固化过，作废旧值
const COL_WIDTHS_KEY = "1pannel-group-col-widths-v4";

/** 列 key 列表：与模板中 el-table-column 顺序一一对应（快照列宽用） */
const COL_KEYS = [
  "index", // 序
  "host", // 主机
  "addr", // 地址
  "agent", // Agent
  "user", // 用户
  "version", // 版本
  "spec", // 规格
  "cpu", // CPU
  "mem", // 内存
  "disk", // 磁盘
  "load", // 负载
];

function readColWidths(): Record<string, number> | null {
  try {
    const raw = localStorage.getItem(COL_WIDTHS_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    // 部分固化：只收用户明确改过的列，其余列继续走动态自适应
    const out: Record<string, number> = {};
    for (const key of COL_KEYS) {
      const v = Number((obj as Record<string, unknown>)[key]);
      if (Number.isFinite(v) && v >= 32) out[key] = Math.round(v);
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

/** 用户自定义列宽（null = 默认布局：全部列按内容自适应，剩余宽度留白在表格右缘） */
const colWidths = ref<Record<string, number> | null>(readColWidths());

function persistColWidths() {
  try {
    if (colWidths.value) {
      localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(colWidths.value));
    } else {
      localStorage.removeItem(COL_WIDTHS_KEY);
    }
  } catch {
    /* 忽略 */
  }
}

function resetColWidths() {
  colWidths.value = null;
  persistColWidths();
  scheduleAutoWidths();
}

// ---------- 默认布局：列宽按实际内容动态自适应 ----------

/**
 * 参与内容自适应的列及其设计下限。
 * CPU/内存/磁盘/负载四列是轮询刷新的动态数字，位数随采样变化（0.00↔10.35），
 * 若参与测量列宽会跟着数字宽度来回摆动，故不在此列、恒用模板默认宽。
 */
const COL_MIN: Record<string, number> = {
  index: 64,
  host: 140,
  addr: 150,
  agent: 100,
  user: 64,
  version: 108,
  spec: 80,
};

/** 文本测量之外的图形元素宽度修正：主机列徽标 34 + 间距 8；Agent 列标签底座留白 */
const COL_EXTRA: Record<string, number> = {
  host: 42,
  agent: 24,
};

/** 全列默认宽（模板兜底 & 剩余宽度分配时的非测量列占用） */
const DEFAULT_W: Record<string, number> = {
  index: 64,
  host: 160,
  addr: 170,
  agent: 100,
  user: 64,
  version: 108,
  spec: 80,
  cpu: 68,
  mem: 68,
  disk: 92,
  load: 72,
};

/** 默认布局下各列的内容自适应宽度；用户拖过列宽后由 colWidths 固定，不再动态 */
const autoWidths = ref<Record<string, number>>({});

/** 模板列宽取值：自定义列宽 > 内容自适应宽 */
function colWidth(key: string): number | undefined {
  return colWidths.value?.[key] ?? autoWidths.value[key];
}

let autoWidthTimer = 0;

/** 内容变化后防抖重测：骨架换成数据、Agent 标签、版本规格异步到位都会触发 */
function scheduleAutoWidths() {
  window.clearTimeout(autoWidthTimer);
  autoWidthTimer = window.setTimeout(() => {
    autoWidthTimer = 0;
    measureAutoWidths();
  }, 150);
}

/** 弹性列：吸收表格剩余宽度，短内容列（规格等）保持贴合内容、不被拉长 */
const FLEX_KEYS = ["host", "addr"];

/** 测未固化列（含表头）的文本内容宽度，取「内容宽 / 设计下限」较大者 */
function measureAutoWidths() {
  if (viewMode.value !== "table") return;
  const root = hostTableRef.value?.$el as HTMLElement | undefined;
  if (!root) return;
  const ths = Array.from(
    root.querySelectorAll<HTMLElement>(".el-table__header thead th")
  ).filter((el) => !el.classList.contains("gutter"));
  const rows = root.querySelectorAll<HTMLElement>(".el-table__body tbody tr");
  if (ths.length < COL_KEYS.length || rows.length === 0) return;
  const out: Record<string, number> = {};
  for (const key of Object.keys(COL_MIN)) {
    if (colWidths.value?.[key]) continue; // 用户固化过的列不再动态
    const idx = COL_KEYS.indexOf(key);
    const maxW = columnTextWidth(root, idx);
    // 图形元素常量修正 + .cell 24px 内边距 + td 12px×2 再留 2px 余量；
    // 上限防超长主机名/版本号把列撑爆，超长交给省略号 + 悬浮提示
    out[key] = Math.min(
      320,
      Math.max(COL_MIN[key], maxW + (COL_EXTRA[key] || 0) + 24 + 2)
    );
  }

  // 表格总宽锁死容器宽：全部列按「固化值 > 内容测量值 > 默认值」先就位，
  // 剩余宽度只平分给弹性列（主机/地址），其余列严格贴合内容
  const containerW = Math.round(root.getBoundingClientRect().width);
  let used = 0;
  const flexPending: string[] = [];
  for (const key of COL_KEYS) {
    const fixedW = colWidths.value?.[key];
    if (fixedW) {
      used += fixedW;
      continue;
    }
    const baseW = out[key] ?? DEFAULT_W[key];
    used += baseW;
    if (FLEX_KEYS.includes(key)) flexPending.push(key);
  }
  const remaining = containerW - used - 2;
  if (remaining > 0 && flexPending.length > 0) {
    const share = Math.floor(remaining / flexPending.length);
    flexPending.forEach((key) => {
      out[key] = (out[key] ?? DEFAULT_W[key]) + share;
    });
  }
  autoWidths.value = out;
}

const hostTableRef = ref<{ $el?: HTMLElement } | null>(null);

const HEADER_RESIZE_ZONE = 8; // 与热区伪元素同宽

/** 表头 mousedown：命中分界线热区则拦截 EP 原生拖拽，自接管改列宽。
 *  EP 的拖拽在 WKWebView 上状态可能卡死（mouseup 丢失后列宽持续跟随鼠标），
 *  且双击会误触发 header-dragend，全部绕开。 */
function onHeaderResizeDown(e: MouseEvent) {
  const th = (e.target as HTMLElement | null)?.closest("th");
  if (!th || th.classList.contains("gutter")) return;
  const headerThs = Array.from(
    th.parentElement?.children ?? []
  ).filter((el) => el.tagName === "TH" && !(el as HTMLElement).classList.contains("gutter"));
  const idx = headerThs.indexOf(th);
  if (idx < 0) return;
  const rect = th.getBoundingClientRect();
  let colIdx = idx;
  if (rect.right - e.clientX > HEADER_RESIZE_ZONE) {
    // 不在右缘热区：看是否命中左缘（调整左邻列）
    if (idx > 0 && e.clientX - rect.left <= HEADER_RESIZE_ZONE) {
      colIdx = idx - 1;
    } else {
      return;
    }
  }
  if (colIdx >= COL_KEYS.length) return;
  e.stopPropagation(); // 阻断 EP 的 th mousedown（拖拽启动）
  e.preventDefault(); // 阻止表头文本选择
  const key = COL_KEYS[colIdx];
  const startW = Math.round(th.getBoundingClientRect().width);
  const startX = e.clientX;
  const onMove = (ev: MouseEvent) => {
    const next = Math.min(800, Math.max(32, startW + ev.clientX - startX));
    colWidths.value = { ...(colWidths.value || {}), [key]: next };
  };
  const onUp = () => {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("mouseup", onUp, true);
    persistColWidths();
    scheduleAutoWidths(); // 动态列重新分摊剩余宽度，保持表格满宽
  };
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("mouseup", onUp, true);
}

/** 双击表头列分界线：自动适配左侧一列的内容宽度 */
function onHeaderDblClick(e: MouseEvent) {
  const th = (e.target as HTMLElement | null)?.closest("th");
  if (!th || th.classList.contains("gutter") || !th.parentElement) return;
  const ths = Array.from(th.parentElement.children).filter(
    (el) => el.tagName === "TH" && !el.classList.contains("gutter")
  );
  const idx = ths.indexOf(th);
  if (idx < 0) return;
  const rect = th.getBoundingClientRect();
  if (rect.right - e.clientX <= HEADER_RESIZE_ZONE) {
    autoFitColumn(idx);
  } else if (idx > 0 && e.clientX - rect.left <= HEADER_RESIZE_ZONE) {
    autoFitColumn(idx - 1);
  }
}

// ---------- 内容宽度测量：Canvas 文本量宽 ----------
// 不用「克隆 .cell + max-content」：WebKit（WKWebView）对克隆里百分比宽图形元素、
// flex 子项的 max-content 解析与 Chromium 不一致，会量出虚大宽度（列被双击撑爆）。
// Canvas 按元素自身字体直接量文本排版宽，不受当前布局/列宽/图形元素影响，两引擎一致。

const measureCanvas = document.createElement("canvas").getContext("2d")!;

/** 用元素自身的 computed 字体在 Canvas 里量其文本的排版宽 */
function textWidth(el: HTMLElement): number {
  const cs = window.getComputedStyle(el);
  measureCanvas.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  return Math.ceil(measureCanvas.measureText((el.textContent || "").trim()).width);
}

/**
 * 量 cell 的内容宽：对 cell 及每个后代元素，用其自身字体量「全文拼接宽」取最大。
 * 同行并排的多个文本块（如磁盘列的 百分比+容量）由父容器全文覆盖；
 * 混合字号的拼接按容器字体量，稍偏保守（宁宽勿截断）。
 * 图形元素（进度条/骨架/徽标）无文本不参与，按列走 COL_EXTRA 常量修正。
 */
function measureCellWidth(cellDiv: HTMLElement | null): number {
  if (!cellDiv) return 0;
  let max = 0;
  const walk = (el: HTMLElement) => {
    const text = (el.textContent || "").trim();
    if (text) max = Math.max(max, textWidth(el));
    Array.from(el.children).forEach((child) => walk(child as HTMLElement));
  };
  walk(cellDiv);
  return max;
}

/** 表头 + 全部数据行该列的文本内容宽最大值 */
function columnTextWidth(root: HTMLElement, idx: number): number {
  const ths = Array.from(
    root.querySelectorAll<HTMLElement>(".el-table__header thead th")
  ).filter((el) => !el.classList.contains("gutter"));
  let maxW = measureCellWidth(ths[idx]?.querySelector<HTMLElement>("div.cell") ?? null);
  root
    .querySelectorAll<HTMLElement>(".el-table__body tbody tr")
    .forEach((tr) => {
      const td = tr.children[idx] as HTMLElement | undefined;
      maxW = Math.max(
        maxW,
        measureCellWidth(td?.querySelector<HTMLElement>("div.cell") ?? null)
      );
    });
  return maxW;
}

/** 测量该列所有单元格（含表头）的自然宽度，取最大值定为列宽 */
function autoFitColumn(idx: number) {
  const root = hostTableRef.value?.$el as HTMLElement | undefined;
  if (!root || idx < 0 || idx >= COL_KEYS.length) return;
  const key = COL_KEYS[idx];
  const maxW = columnTextWidth(root, idx);
  if (maxW <= 0) return;
  // 图形元素常量修正 + .cell 24px 内边距 + td 12px×2 再留 2px 余量
  const fitted = Math.min(
    320,
    Math.max(48, maxW + (COL_EXTRA[key] || 0) + 24 + 2)
  );
  // 只固化这一列，其余列保持原有状态（动态或已固化）
  colWidths.value = { ...(colWidths.value || {}), [key]: fitted };
  persistColWidths();
  scheduleAutoWidths(); // 动态列重新分摊剩余宽度，保持表格满宽
}

const canEditGroup = computed(() => props.groupId !== UNGROUPED_ID);

const boardTitle = computed(() => {
  if (!canEditGroup.value) return "";
  const g = app.groupList.find((x) => x.id === props.groupId);
  return (g?.boardTitle || "").trim();
});

const groupSettingsOpen = ref(false);
const groupSettingsSaving = ref(false);
const settingsName = ref("");
const settingsBoardTitle = ref("");
const groupNameInputRef = ref<{ focus?: () => void } | null>(null);

function openGroupSettings() {
  if (!canEditGroup.value) return;
  settingsName.value = props.groupName || "";
  settingsBoardTitle.value = boardTitle.value;
  groupSettingsOpen.value = true;
}

function onGroupSettingsOpened() {
  groupNameInputRef.value?.focus?.();
}

async function saveGroupSettings() {
  if (!canEditGroup.value || groupSettingsSaving.value) return;
  const nextName = settingsName.value.trim();
  if (!nextName) {
    ElMessage.warning("分组名称不能为空");
    return;
  }
  groupSettingsSaving.value = true;
  try {
    if (nextName !== props.groupName) {
      await app.renameGroup(props.groupId, nextName);
    }
    const nextBoard = settingsBoardTitle.value.trim();
    if (nextBoard !== boardTitle.value) {
      await app.setBoardTitle(props.groupId, nextBoard);
    }
    groupSettingsOpen.value = false;
    ElMessage.success("已保存");
  } catch (err) {
    ElMessage.error(`保存失败: ${formatErr(err)}`);
  } finally {
    groupSettingsSaving.value = false;
  }
}

const THRESHOLDS = ALERT;
const POLL_MS = 3000;

/** 单主机面板状态：标题/地址来自 store（同步），指标通过 per-host 异步加载 */
interface HostSnap {
  loading: boolean;
  overview?: monitor.Overview;
  disks?: monitor.DiskInfo[];
  error?: string;
  /** 错误发生时刻（展示新鲜度用；成功刷新时随 error 一并清除） */
  errorAt?: number;
}

/** 错误时间后缀（HH:MM），无时间返回空串 */
function errTimeSuffix(at?: number): string {
  if (!at) {
    return "";
  }
  const t = new Date(at);
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");
  return `（${hh}:${mm}）`;
}

/** 错误文案补发生时间，便于区分「刚失败」与「陈旧错误」 */
function withErrTime(err: string, at?: number): string {
  return at ? err + errTimeSuffix(at) : err;
}

const refreshing = ref(false);

/** 当前组内主机列表：子树全部主机（本层+子孙） */
const hosts = computed<sshconfig.HostConfig[]>(() => {
  if (props.groupId === UNGROUPED_ID) {
    const node = app.groupNodes.find((n) => !n.group);
    return node?.hosts ?? [];
  }
  const node = app.findGroupNode(props.groupId);
  return node?.subtreeHosts ?? [];
});

/** 每主机独立的指标状态：key=host.name */
const hostStates = ref<Record<string, HostSnap>>({});

/** 看板卡片：映射页内 hostStates（暂不传 trends） */
const boardCards = computed<Record<string, BoardHostCard>>(() => {
  const out: Record<string, BoardHostCard> = {};
  for (const h of hosts.value) {
    const s = hostStates.value[h.name] || { loading: true };
    out[h.name] = {
      loading: s.loading,
      overview: s.overview,
      disks: s.disks,
      error: s.error ? withErrTime(s.error, s.errorAt) : undefined,
    };
  }
  return out;
});

/** 当前活跃组 id，防止旧组请求覆盖新组 */
let activeGroupId = props.groupId;
const inFlight = new Set<string>();
let prevAlertKeys = new Set<string>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
/** 空闲降频：分组页不可见时两次轮询的最小间隔 */
const IDLE_MIN_INTERVAL_MS = 30_000;
let lastPollAt = 0;

function hostState(name: string): HostSnap {
  let s = hostStates.value[name];
  if (!s) {
    s = { loading: true };
    hostStates.value[name] = s;
  }
  return s;
}

function openHost(name: string) {
  app.openHostTab(name);
}

/** 打开添加主机弹窗（App 监听 app-add-host） */
function openAddHost() {
  const gid = props.groupId === UNGROUPED_ID ? "" : props.groupId;
  void Events.Emit("app-add-host", { groupId: gid });
}

/** 看板独立窗：打开或聚焦 Name=board-{groupId} 的普通窗（可再全屏） */
const boardOpening = ref(false);

async function openBoardWindow() {
  boardOpening.value = true;
  try {
    await api.openBoardWindow(props.groupId || UNGROUPED_ID);
  } catch (e) {
    ElMessage.error(formatErr(e));
  } finally {
    boardOpening.value = false;
  }
}

// ---------- 指标 / 告警 ----------

function hostSpec(ov: monitor.Overview): string {
  const cores = ov.cpuCount || 0;
  return `${cores}核${formatMemCapacity(ov.memTotal || 0)}`;
}

function isHostAlert(s: HostSnap): boolean {
  if (s.error || !s.overview) return false;
  const ov = s.overview;
  if (isCpuAlert(ov) || isMemAlert(ov) || isLoadAlert(ov)) return true;
  if (isDiskLow(s.disks)) return true;
  return false;
}

// ---------- 单主机加载（独立，互不阻塞）----------

async function loadOne(name: string, showSkeleton: boolean, force = false) {
  if (inFlight.has(name)) return;
  if (activeGroupId !== props.groupId) return;
  const prev = hostStates.value[name];
  // 未装 Agent 时避免轮询空打；force / 手动刷新 / 安装完成后应允许重试
  if (!force && prev?.error && isAgentMissing(prev.error)) return;
  inFlight.add(name);
  if (showSkeleton) {
    hostStates.value[name] = { loading: true };
  }
  try {
    const ov = await api.collectOverview(name);
    let disks: monitor.DiskInfo[] = [];
    try {
      disks = (await api.collectDisks(name)) || [];
    } catch {
      disks = [];
    }
    if (activeGroupId !== props.groupId) return;
    hostStates.value[name] = { loading: false, overview: ov, disks, error: undefined };
    notifyAllAlerts();
  } catch (e) {
    if (activeGroupId !== props.groupId) return;
    hostStates.value[name] = {
      loading: false,
      error: formatErr(e),
      errorAt: Date.now(),
    };
    notifyAllAlerts();
  } finally {
    inFlight.delete(name);
  }
}

/** 清除「未装 Agent」粘性错误，并强制重新采集概览（安装成功 / 手动刷新后） */
function resumeHostAfterAgentReady(name: string) {
  const cur = hostStates.value[name];
  if (cur?.error && isAgentMissing(cur.error)) {
    hostStates.value[name] = { loading: false };
  } else if (cur?.error) {
    hostStates.value[name] = { ...cur, error: undefined, errorAt: undefined };
  }
  void loadOne(name, false, true);
}

/** 手动刷新（按钮）：静默重载（按钮自身有 loading 转圈）。
 *  不走骨架路径：骨架会先抹掉已有数据，逐台恢复期间告警键反复进出
 *  去重集合，导致仍存在的告警被当新告警重复弹窗 */
async function refreshAll() {
  refreshing.value = true;
  try {
    await Promise.allSettled(
      hosts.value.map((h) => loadOne(h.name, false, true))
    );
    await loadAgentStatuses();
  } finally {
    refreshing.value = false;
  }
}

// ---------- 告警通知 ----------

function collectHostAlerts(name: string): { key: string; line: string }[] {
  const s = hostStates.value[name];
  if (!s) return [];
  if (s.error) {
    if (isAgentMissing(s.error) || isAgentNoSample(s.error)) return [];
    return [
      {
        key: `${name}|conn`,
        line: `「${name}」连接失败${errTimeSuffix(s.errorAt)}：${s.error}`,
      },
    ];
  }
  const ov = s.overview;
  if (!ov) return [];
  const out: { key: string; line: string }[] = [];
  const cpu = ov.cpuPercent || 0;
  if (cpu >= THRESHOLDS.cpu) {
    out.push({ key: `${name}|cpu`, line: `「${name}」CPU ${cpu.toFixed(1)}% ≥ ${THRESHOLDS.cpu}%` });
  }
  const mem = ov.memPercent || 0;
  if (mem > THRESHOLDS.mem) {
    out.push({ key: `${name}|mem`, line: `「${name}」内存 ${mem.toFixed(1)}% 超过 ${THRESHOLDS.mem}%` });
  }
  if (isDiskLow(s.disks)) {
    out.push({ key: `${name}|disk`, line: diskLowMessage(name, s.disks) });
  }
  if (isLoadAlert(ov)) {
    out.push({
      key: `${name}|load`,
      line: `「${name}」负载 ${ov.load1.toFixed(2)} / ${ov.cpuCount} 核 超过警戒`,
    });
  }
  return out;
}

function notifyAllAlerts() {
  const next = new Set<string>();
  const newLines: string[] = [];
  for (const h of hosts.value) {
    for (const a of collectHostAlerts(h.name)) {
      next.add(a.key);
      if (!prevAlertKeys.has(a.key)) {
        const kind = hostWecomKindFromKey(a.key);
        if (shouldToastHostAlert(h.name, kind)) {
          newLines.push(a.line);
        }
        if (kind) {
          void fireHostWecom({
            key: a.key,
            host: h.name,
            kind,
            detail: a.line,
          });
        }
      }
    }
  }
  for (const key of prevAlertKeys) {
    if (next.has(key)) continue;
    const kind = hostWecomKindFromKey(key);
    if (!kind) continue;
    const host = key.slice(0, -(kind.length + 1));
    void clearHostWecom({ key, host, kind });
  }
  prevAlertKeys = next;
  if (newLines.length > 0) {
    const title = newLines.length === 1 ? "主机告警" : `主机告警（${newLines.length} 项）`;
    const body = newLines.length <= 6
      ? newLines.join("\n")
      : `${newLines.slice(0, 6).join("\n")}\n…另有 ${newLines.length - 6} 项`;
    ElNotification({
      type: "error",
      title,
      message: body,
      duration: 10000,
      position: "top-right",
      showClose: true,
      zIndex: 50000,
      customClass: "group-alert-notify",
    });
  }
}

function tableRowClass({ row }: { row: sshconfig.HostConfig }) {
  const s = hostState(row.name);
  if (s.error || isHostAlert(s)) return "host-list-row is-danger-row";
  return "host-list-row";
}

/** 从 PRETTY_NAME 抽出版本号（主机列已有发行版图标，此处不重复系统名） */
function osVersion(osRelease: string): string {
  const s = (osRelease || "").trim();
  if (!s) return "";
  // "Ubuntu 22.04.5 LTS" / "Debian GNU/Linux 12 (bookworm)" / "Alpine Linux v3.20"
  const ver = s.match(/\bv?\d+(?:\.\d+)+(?:\.\d+)?(?:\s+LTS)?\b/i);
  if (ver) {
    return ver[0].replace(/^v/i, "");
  }
  // 无数字版本时退回去掉发行版名的尾部，避免整串空白
  const stripped = s.replace(/^[A-Za-z][A-Za-z0-9+.\- ]*?\s+(?=\d|v\d|\()/i, "").trim();
  return stripped || s;
}

// ---------- 轮询 ----------

function startPoll() {
  stopPoll();
  pollTimer = setInterval(() => {
    if (activeGroupId !== props.groupId) return;
    // 空闲降频：分组页被切走（或设置页打开）时拉长到 30s 一拍，
    // 可见时按原 3s 节奏
    if (!app.isGroupVisible(props.groupId) && Date.now() - lastPollAt < IDLE_MIN_INTERVAL_MS) {
      return;
    }
    lastPollAt = Date.now();
    // 静默轮询：不切 loading（避免列表跳动）
    for (const h of hosts.value) {
      void loadOne(h.name, false);
    }
  }, POLL_MS);
}

function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ---------- 切换组 / 卸载 ----------

// ---------- Agent 状态 ----------
/** 每主机 agent 状态（后端 30s 缓存，徽章列显示） */
const agentStatuses = ref<Record<string, agentcli.Status>>({});
const latestAgentVersion = ref("");

async function loadAgentStatuses() {
  const names = hosts.value.map((h) => h.name);
  await Promise.all(
    names.map(async (n) => {
      try {
        agentStatuses.value[n] = await api.agentStatus(n);
      } catch {
        /* 徽章显示离线即可 */
      }
    })
  );
  if (!latestAgentVersion.value) {
    try {
      latestAgentVersion.value = await api.agentLatestVersion();
    } catch {
      /* 忽略 */
    }
  }
}

function agentTagOf(name: string): { type: string; text: string } {
  const st = agentStatuses.value[name];
  if (!st?.ok) return { type: "info", text: "未装" };
  if (latestAgentVersion.value && st.version !== latestAgentVersion.value) {
    return { type: "warning", text: "可更新" };
  }
  return { type: "success", text: `v${st.version}` };
}

/** 批量安装进度 */
const batchBusy = ref(false);
const batchDialogVisible = ref(false);
const batchDone = ref(false);

type BatchRowState = "pending" | "running" | "done" | "error";
interface BatchRow {
  host: string;
  state: BatchRowState;
  step: string;
  percent: number;
  error?: string;
  version?: string;
}

const BATCH_STEP_LABEL: Record<string, string> = {
  probe: "探测主机状态",
  upload: "上传 Agent",
  replace: "替换二进制",
  start: "启动服务",
  verify: "验证版本",
  done: "完成",
  error: "失败",
};

const batchRows = ref<BatchRow[]>([]);
const batchRowMap = computed(() => {
  const m: Record<string, BatchRow> = {};
  for (const r of batchRows.value) m[r.host] = r;
  return m;
});

const batchSummaryText = computed(() => {
  const total = batchRows.value.length;
  const done = batchRows.value.filter((r) => r.state === "done").length;
  const err = batchRows.value.filter((r) => r.state === "error").length;
  if (!batchDone.value) {
    return `进行中 ${done + err}/${total} · 全部主机并行`;
  }
  if (err > 0) {
    return `完成 ${done}/${total} · ${err} 台失败`;
  }
  return `全部 ${total} 台安装完成`;
});

let offBatchProgress: (() => void) | null = null;

function batchProgressOf(name: string): BatchRow | undefined {
  if (!batchBusy.value && !batchDialogVisible.value) return undefined;
  return batchRowMap.value[name];
}

function batchProgressLabel(name: string): string {
  const r = batchProgressOf(name);
  if (!r) return "";
  return batchRowLabel(r);
}

function batchRowLabel(r: BatchRow): string {
  if (r.state === "pending") return "排队中";
  if (r.state === "done") {
    if (r.version) {
      return `已是最新 v${r.version}`;
    }
    return "完成";
  }
  if (r.state === "error") return r.error ? `失败：${r.error}` : "失败";
  const step = BATCH_STEP_LABEL[r.step] || r.step || "安装中";
  if (r.step === "upload" && r.percent >= 0) {
    return `${step} ${r.percent}%`;
  }
  return step;
}

function applyBatchProgress(d: {
  host?: string;
  step?: string;
  percent?: number;
  text?: string;
}) {
  if (!d.host) return;
  const row = batchRowMap.value[d.host];
  if (!row) return;
  const step = d.step || "";
  if (step === "done") {
    row.state = "done";
    row.step = "done";
    row.percent = 100;
    if (d.text) {
      // 文案可能含版本号，尽量提取；最终以 API 结果为准
      const m = d.text.match(/v?(\d+\.\d+\.\d+)/);
      if (m) row.version = m[1];
    }
    return;
  }
  if (step === "error") {
    row.state = "error";
    row.step = "error";
    row.error = d.text || "安装失败";
    return;
  }
  row.state = "running";
  row.step = step;
  if (typeof d.percent === "number") {
    row.percent = d.percent;
  }
}

function bindBatchProgress() {
  unbindBatchProgress();
  offBatchProgress = Events.On(
    "agent-install-progress",
    (ev: { data?: { host?: string; step?: string; percent?: number; text?: string } }) => {
      const d = ev?.data;
      if (d) applyBatchProgress(d);
    }
  );
}

function unbindBatchProgress() {
  if (offBatchProgress) {
    offBatchProgress();
    offBatchProgress = null;
  }
}

function onBatchDialogClosed() {
  if (!batchBusy.value) {
    batchRows.value = [];
    batchDone.value = false;
  }
}

/** 批量安装：弹进度窗，订阅各主机 agent-install-progress，完成后汇总 */
async function batchInstallAgent() {
  if (batchBusy.value || agentInstall.running) {
    ElNotification.warning({
      title: "请稍候",
      message: agentInstall.running
        ? "单台安装仍在进行中"
        : "安装进行中",
      duration: 3000,
    });
    return;
  }
  const targets = hosts.value.map((h) => h.name);
  if (!targets.length) return;

  const needInstall = targets.filter((n) => agentTagOf(n).type !== "success");
  const alreadyOk = targets.filter((n) => agentTagOf(n).type === "success");
  const needCount = needInstall.length;
  const scope = `本组全部 ${targets.length} 台`;
  try {
    await ElMessageBox.confirm(
      `将向${scope}主机安装 spanel-agent（内置 v${latestAgentVersion.value || "?"}，历史数据保留）。` +
        `其中 ${needCount} 台未装或可更新` +
        (alreadyOk.length ? `，${alreadyOk.length} 台已是最新将跳过` : "") +
        `。全部并行，可在进度窗口查看各主机状态。`,
      "安装 Agent",
      { confirmButtonText: "开始", cancelButtonText: "取消", type: "info" }
    );
  } catch {
    return;
  }

  batchRows.value = [
    ...alreadyOk.map((host) => ({
      host,
      state: "done" as const,
      step: "done",
      percent: 100,
      version: latestAgentVersion.value || agentStatuses.value[host]?.version || "",
    })),
    ...needInstall.map((host) => ({
      host,
      state: "pending" as const,
      step: "",
      percent: -1,
    })),
  ];
  batchDone.value = needInstall.length === 0;
  batchDialogVisible.value = true;
  if (needInstall.length === 0) {
    return;
  }

  batchBusy.value = true;
  bindBatchProgress();

  try {
    const results = await api.batchInstallAgent(needInstall);
    for (const r of results) {
      const row = batchRowMap.value[r.host];
      if (!row) continue;
      if (r.ok) {
        row.state = "done";
        row.step = "done";
        row.version = r.version || row.version;
        row.percent = 100;
      } else {
        row.state = "error";
        row.step = "error";
        row.error = r.error || "失败";
      }
    }
    batchDone.value = true;
    await loadAgentStatuses();
    // 安装成功后清掉「未装」粘性错误并重拉概览，否则状态会一直红
    for (const r of results) {
      if (r.ok) resumeHostAfterAgentReady(r.host);
    }
    for (const name of alreadyOk) {
      resumeHostAfterAgentReady(name);
    }
  } catch (e) {
    batchDone.value = true;
    ElNotification.error({
      title: "安装失败",
      message: formatErr(e),
      duration: 5000,
    });
  } finally {
    batchBusy.value = false;
    unbindBatchProgress();
  }
}

watch(
  hosts,
  (h) => {
    activeGroupId = props.groupId;
    const fresh: Record<string, HostSnap> = {};
    for (const host of h) {
      const existing = hostStates.value[host.name];
      fresh[host.name] = existing ?? { loading: true };
    }
    hostStates.value = fresh;
    // 注意：不重置 prevAlertKeys（store 刷新频繁触发本 watch，
    // 清空会导致仍存在的告警被当新告警重复弹窗）；仅切组时重置。
    // 已有数据的主机静默刷新，避免 Cmd+R 时全组闪骨架
    for (const host of h) {
      void loadOne(host.name, !fresh[host.name].overview);
    }
    void loadAgentStatuses();
    scheduleAutoWidths();
  },
  { immediate: true }
);

// 数据到位（骨架 → 版本/规格/Agent 标签）后重测默认列宽；用户拖过列宽则自动跳过
watch(hostStates, scheduleAutoWidths, { deep: true });

watch(
  () => props.groupId,
  () => {
    activeGroupId = props.groupId;
    hostStates.value = {};
    prevAlertKeys = new Set();
    stopPoll();
    startPoll();
  }
);

watch(
  () => agentInstall.lastInstalled,
  (info) => {
    if (info && hosts.value.some((h) => h.name === info.host)) {
      resumeHostAfterAgentReady(info.host);
      void loadAgentStatuses();
    }
  }
);

// 切回本分组页立即补刷：降频期间数据最多落后 30s，回来要立刻最新
watch(
  () => app.isGroupVisible(props.groupId),
  (now, prev) => {
    if (now && !prev) {
      for (const h of hosts.value) {
        void loadOne(h.name, false);
      }
    }
  }
);

onBeforeUnmount(() => {
  stopPoll();
  unbindBatchProgress();
  window.clearTimeout(autoWidthTimer);
  activeGroupId = ""; // 取消所有 in-flight
});

// ---------- 子组件：单元格（骨架 + 数值）----------

const MetricCell = defineComponent({
  name: "MetricCell",
  props: {
    snap: { type: Object as () => HostSnap, required: true },
    field: { type: String, required: true },
    fallback: { type: [String, Number], default: "—" },
    format: { type: Function, default: (v: any) => v },
    percent: { type: Boolean, default: false },
    disks: { type: Array as () => monitor.DiskInfo[] | undefined, default: undefined },
    "alert-threshold": { type: Number, default: 0 },
    "alert-op": { type: String, default: "ge" }, // "ge" or "gt"
    suffix: { type: String, default: "" },
    sub: { type: String, default: "" },
  },
  setup(p) {
    return () => {
      const s = p.snap;
      const loading = s.loading && !s.overview;
      const err = !!s.error || !s.overview;
      if (loading) {
        return h(ElSkeleton, { rows: 1, animated: true, style: { width: "100%" } }, {
          template: () => h(ElSkeletonItem, { variant: "text", style: { width: "100%" } }),
        });
      }
      if (err) return h("span", null, "—");
      const ov = s.overview!;
      let value: any;
      let display: any;
      let alert = false;
      if (p.field === "diskPercent") {
        const sum = summarizeDisks(p.disks);
        value = sum?.percent ?? 0;
        display = `${value.toFixed(1)}%`;
        alert = isDiskLow(p.disks);
        const capacity = sum ? formatBytes(sum.total) : "";
        return h("div", { class: "list-metric" }, [
          h("div", { class: "list-metric-bar" }, h(ElProgress, {
            percentage: Math.min(100, Math.max(0, value || 0)),
            strokeWidth: 4,
            showText: false,
            color: alert ? "var(--m3-error)" : "var(--m3-primary)",
          })),
          h("div", { class: "list-metric-nums" }, [
            h("span", { class: ["list-metric-val", alert ? "is-alert" : ""] }, display),
            capacity
              ? h("span", { class: ["list-metric-sub", alert ? "is-alert" : ""] }, capacity)
              : null,
          ]),
        ]);
      } else {
        const raw = (ov as any)[p.field] ?? 0;
        if (p.percent) {
          value = raw;
          display = `${raw.toFixed(1)}${p.suffix}`;
          alert = p["alert-op"] === "gt" ? raw > p["alert-threshold"] : raw >= p["alert-threshold"];
        } else {
          display = p.format(raw);
        }
      }
      if (p.percent) {
        return h("div", { class: "list-metric" }, [
          h("div", { class: "list-metric-bar" }, h(ElProgress, {
            percentage: Math.min(100, Math.max(0, value || 0)),
            strokeWidth: 4,
            showText: false,
            color: alert ? "var(--m3-error)" : "var(--m3-primary)",
          })),
          h("div", { class: "list-metric-nums" }, [
            h("span", { class: ["list-metric-val", alert ? "is-alert" : ""] }, display),
            p.sub
              ? h("span", { class: ["list-metric-sub", alert ? "is-alert" : ""] }, p.sub)
              : null,
          ]),
        ]);
      }
      return h("span", null, display);
    };
  },
});

startPoll();
</script>

<style scoped lang="scss">
.group-overview {
  min-height: 0;
  height: 100%;
  box-sizing: border-box;
  background: transparent;
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 12px 16px 16px;

  &.is-drop-target {
    outline: 2px solid var(--m3-primary);
    outline-offset: -2px;
    border-radius: var(--m3-shape-m, 12px);
    background: color-mix(in srgb, var(--m3-primary) 6%, transparent);
  }
}

.board-embed-wrap {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.group-empty {
  flex: 1;
  min-height: 280px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 48px 24px;
  text-align: center;
  border: 2px dashed var(--m3-outline-variant);
  border-radius: var(--m3-shape-l, 16px);
  background: color-mix(in srgb, var(--m3-surface-container) 60%, transparent);
  box-sizing: border-box;
}

.group-empty__title {
  margin: 0;
  font: var(--m3-headline-small);
  font-weight: 600;
  color: var(--m3-on-surface);
}

.group-empty__hint {
  margin: 0 0 8px;
  max-width: 360px;
  font: var(--m3-body-medium);
  color: var(--m3-on-surface-variant);
  line-height: 1.5;
}

.group-status-chip {
  height: 24px;
  max-width: 100%;
  padding: 0 8px;
  border-radius: var(--m3-shape-full) !important;
  font: var(--m3-label-medium);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.host-list-wrap {
  min-width: 0;
  min-height: 0;
  flex: 1;
  overflow: auto;
  background: transparent;
}

.host-list-table {
  width: 100%;
  cursor: pointer;

  // border 仅为启用 EP 列宽拖拽，视觉保持无竖线的清爽样式
  &.el-table--border {
    &::before,
    &::after {
      content: none;
    }
    :deep(.el-table__cell) {
      border-right: none !important;
    }
    :deep(th.el-table__cell) {
      border-bottom: none !important;
    }
  }

  // 列宽可拖后允许横向滚动（.data-table-unified 全局禁了横滚）
  :deep(.el-table__header-wrapper .el-scrollbar__wrap),
  :deep(.el-table__body-wrapper .el-scrollbar__wrap) {
    overflow-x: auto !important;
  }
  :deep(.el-scrollbar__bar.is-horizontal) {
    display: block !important;
  }

  :deep(.group-index-col .cell) {
    overflow: visible;
    text-overflow: clip;
    font-variant-numeric: tabular-nums;
  }

  // 表头右缘 8px 是列宽拖拽热区：悬停亮出分割线，提示可拖拽 / 双击自适应
  :deep(th.el-table__cell) {
    // 固定列本身是 sticky 定位可直接挂热区；普通列补 relative 作锚点
    &:not(.el-table-fixed-column--left):not(.el-table-fixed-column--right) {
      position: relative;
    }

    &::after {
      content: "";
      position: absolute;
      z-index: 2;
      top: 25%;
      bottom: 25%;
      right: -4px;
      width: 8px;
      cursor: col-resize;
    }

    &:hover::before {
      content: "";
      position: absolute;
      z-index: 2;
      top: 25%;
      bottom: 25%;
      right: 0;
      width: 0;
      border-right: 2px solid var(--m3-primary);
      border-radius: 2px;
    }
  }

  :deep(.host-list-row) {
    cursor: pointer;
  }
  :deep(.host-list-row.is-danger-row > td.el-table__cell) {
    background: var(--m3-error-container, #fef0f0) !important;
    color: var(--m3-error);
  }
  :deep(.host-list-row.is-danger-row .list-host-name),
  :deep(.host-list-row.is-danger-row .group-index-col .cell),
  :deep(.host-list-row.is-danger-row .mono) {
    color: var(--m3-error);
  }
  :deep(.el-table__row:hover > td.el-table__cell) {
    background: color-mix(
      in srgb,
      var(--m3-primary) 6%,
      var(--m3-surface-container-lowest)
    ) !important;
  }
  :deep(.host-list-row.is-danger-row:hover > td.el-table__cell) {
    background: color-mix(
      in srgb,
      var(--m3-error) 12%,
      var(--m3-surface-container-lowest)
    ) !important;
  }

  :deep(.list-metric-bar .el-progress-bar__outer) {
    background: var(--m3-surface-container-highest) !important;
    border-radius: var(--m3-shape-full);
  }

  :deep(.list-metric-bar .el-progress-bar__inner) {
    border-radius: var(--m3-shape-full);
  }
}

.list-host-name {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-weight: 600;
  white-space: nowrap;
}
.list-host-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.list-os-ico {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.mono {
  font-family: var(--m3-font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 13px;
}
.list-err {
  font-size: 12px;
  color: var(--m3-error);
}
.load-cell {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  &.is-alert {
    color: var(--m3-error);
    font-weight: 600;
  }
}
.load-sep {
  margin: 0 2px;
  color: var(--m3-on-surface-variant);
}
.load-cores {
  color: var(--m3-on-surface-variant);
  font-size: 12px;
}
:deep(.list-metric) {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
:deep(.list-metric-nums) {
  display: flex;
  align-items: baseline;
  min-width: 0;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
:deep(.list-metric-val) {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.2;
  &.is-alert {
    color: var(--m3-error) !important;
    font-weight: 700;
  }
}
:deep(.list-metric-sub) {
  font-size: 11px;
  line-height: 1.2;
  color: var(--m3-on-surface-variant);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  &.is-alert {
    color: var(--m3-error);
  }
}

.agent-progress-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.agent-progress-text {
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  &.is-running {
    color: var(--m3-primary);
  }
  &.is-done {
    color: var(--m3-primary);
  }
  &.is-error {
    color: var(--m3-error);
  }
}
</style>

<style lang="scss">
.group-alert-notify {
  white-space: pre-line !important;
  max-width: 420px;
  border-left: 4px solid var(--m3-error) !important;
  background: var(--m3-surface-container-lowest) !important;
  border-radius: var(--m3-shape-m) !important;
}
.group-alert-notify .el-notification__title {
  color: var(--m3-error);
  font-weight: 700;
}
.group-alert-notify .el-notification__content {
  white-space: pre-line;
  line-height: 1.55;
  font-size: 13px;
}

/* append-to-body：弹窗外壳与列表需非 scoped 才能压过 EP 默认 */
.agent-batch-dialog.el-dialog {
  padding: 24px;
  overflow: hidden;
  border: none;
  border-radius: var(--m3-shape-xl) !important;
  background: var(--m3-surface-container-lowest) !important;
  box-shadow: var(--m3-elevation-3) !important;

  .el-dialog__header {
    padding: 0 0 16px;
    margin: 0;
  }

  .el-dialog__title {
    font: var(--m3-headline-small) !important;
    font-weight: 500 !important;
    color: var(--m3-on-surface) !important;
  }

  .el-dialog__headerbtn {
    top: 8px;
    right: 8px;
    width: 40px;
    height: 40px;
  }

  .el-dialog__body {
    padding: 0;
  }

  .el-dialog__footer {
    padding: 20px 0 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
  }

  .batch-summary {
    margin: 0 0 16px;
    padding: 10px 14px;
    border-radius: var(--m3-shape-m);
    background: var(--m3-surface-container);
    font: var(--m3-body-small);
    color: var(--m3-on-surface-variant);
    line-height: 1.45;
  }

  .batch-progress-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: min(52vh, 420px);
    overflow: auto;
    padding-right: 2px;
  }

  .batch-progress-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px 14px;
    border-radius: var(--m3-shape-m);
    background: var(--m3-surface-container-low);
    transition: background-color var(--m3-motion-state);

    &.is-running {
      background: color-mix(
        in srgb,
        var(--m3-primary) 6%,
        var(--m3-surface-container-low)
      );
    }

    &.is-done {
      background: color-mix(
        in srgb,
        var(--m3-primary) 4%,
        var(--m3-surface-container-low)
      );
    }

    &.is-error {
      background: var(--m3-error-container);
    }
  }

  .batch-status-icon {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-top: 1px;

    .el-icon {
      font-size: 18px;
      color: var(--m3-on-surface-variant);
    }

    .is-loading {
      color: var(--m3-primary);
    }
  }

  .batch-progress-row.is-done .batch-status-icon .el-icon {
    color: var(--m3-primary);
  }

  .batch-progress-row.is-error .batch-status-icon .el-icon {
    color: var(--m3-error);
  }

  .batch-row-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .batch-row-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    min-width: 0;
  }

  .batch-host {
    flex: 1;
    min-width: 0;
    font: var(--m3-label-large);
    font-weight: 500;
    color: var(--m3-on-surface);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .batch-label {
    flex-shrink: 0;
    max-width: 52%;
    font: var(--m3-body-small);
    color: var(--m3-on-surface-variant);
    text-align: right;
    word-break: break-word;

    &.is-running {
      color: var(--m3-primary);
      font-weight: 500;
    }

    &.is-done {
      color: var(--m3-primary);
    }

    &.is-error {
      color: var(--m3-error);
    }
  }

  .batch-upload-bar {
    width: 100%;
  }

  .el-progress-bar__outer {
    background: var(--m3-surface-container-highest) !important;
    border-radius: var(--m3-shape-full);
  }

  .el-progress-bar__inner {
    border-radius: var(--m3-shape-full);
    background: var(--m3-primary) !important;
  }

  .batch-running-hint {
    margin: 0;
    flex: 1;
    text-align: left;
    font: var(--m3-body-small);
    color: var(--m3-on-surface-variant);
    line-height: 1.45;
  }

  .batch-done-btn {
    min-width: 88px;
    height: 40px;
    padding: 0 24px;
    border-radius: var(--m3-shape-full);
    font: var(--m3-label-large);
    font-weight: 500;
  }
}
</style>
