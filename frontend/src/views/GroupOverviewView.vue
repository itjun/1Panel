<template>
  <div class="group-overview page-panel">
    <template v-if="hosts.length">
      <div class="page-toolbar">
        <span class="panel-section-title">{{ groupName || "分组概览" }}</span>
        <div class="group-stats">
          <el-tag
            round
            effect="light"
            type="success"
            class="group-stat-chip"
          >
            正常 {{ okCount }}
          </el-tag>
          <el-tag
            v-if="alertCount > 0"
            round
            effect="light"
            type="warning"
            class="group-stat-chip"
          >
            告警 {{ alertCount }}
          </el-tag>
          <el-tag
            v-if="errCount > 0"
            round
            effect="light"
            type="danger"
            class="group-stat-chip"
          >
            失败 {{ errCount }}
          </el-tag>
        </div>
        <div class="page-toolbar__actions">
          <el-button
            class="group-toolbar-btn"
            title="独立窗口全屏看板：可拖到外屏投屏"
            :loading="boardOpening"
            @click="openBoardWindow"
          >
            看板模式
          </el-button>
          <el-button
            class="group-toolbar-btn"
            :loading="batchBusy"
            :disabled="!hosts.length || agentInstall.running"
            title="为本组全部主机安装 Agent"
            @click="batchInstallAgent"
          >
            安装 Agent
          </el-button>
          <el-button
            class="group-toolbar-btn"
            :icon="Refresh"
            :loading="refreshing"
            @click="refreshAll"
          >
            刷新
          </el-button>
          <el-button
            v-if="canEditGroup"
            class="group-toolbar-btn group-toolbar-btn--icon"
            :icon="Setting"
            title="分组设置"
            @click="openGroupSettings"
          />
        </div>
      </div>

      <div class="host-list-wrap m3-table-surface">
        <el-table
          :data="hosts"
          size="default"
          stripe
          class="host-list-table data-table-unified"
          :row-class-name="tableRowClass"
          @row-dblclick="(row: sshconfig.HostConfig) => openHost(row.name)"
        >
          <el-table-column
            type="index"
            label="序"
            width="56"
            fixed
            align="center"
            class-name="group-index-col"
          />
          <el-table-column
            label="主机"
            min-width="150"
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
                    :title="withErrTime(hostState(row.name).error!, hostState(row.name).errorAt)"
                  >
                    <WarningFilled />
                  </el-icon>
                  <DistroLogo
                    v-else
                    :os-release="hostState(row.name).overview?.osRelease || ''"
                    :size="20"
                  />
                </span>
                <span>{{ row.name }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="地址" min-width="130" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="mono">{{ row.hostName || "—" }}</span>
            </template>
          </el-table-column>
          <el-table-column label="Agent" min-width="140">
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
          <el-table-column label="用户" width="88" show-overflow-tooltip>
            <template #default="{ row }">
              {{ row.user || "—" }}
            </template>
          </el-table-column>
          <el-table-column label="版本" min-width="120" show-overflow-tooltip>
            <template #default="{ row }">
              <template v-if="hostState(row.name).error">—</template>
              <span v-else class="mono">{{
                osVersion(hostState(row.name).overview?.osRelease || "") || "—"
              }}</span>
            </template>
          </el-table-column>
          <el-table-column label="规格" min-width="110" show-overflow-tooltip>
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
          <el-table-column label="CPU" min-width="150">
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
          <el-table-column label="内存" min-width="170">
            <template #default="{ row }">
              <MetricCell
                :snap="hostState(row.name)"
                field="memPercent"
                :percent="true"
                :alert-threshold="THRESHOLDS.mem"
                :alert-op="'gt'"
                suffix="%"
                :sub="memUsage(hostState(row.name).overview)"
              />
            </template>
          </el-table-column>
          <el-table-column label="磁盘 /" min-width="170">
            <template #default="{ row }">
              <MetricCell
                :snap="hostState(row.name)"
                field="diskPercent"
                :percent="true"
                :disks="hostState(row.name).disks"
                suffix="%"
                :sub="diskUsage(hostState(row.name).disks) || '—'"
              />
            </template>
          </el-table-column>
          <el-table-column label="负载" min-width="120" align="right">
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
    </template>

    <el-empty v-else description="该分组暂无主机，可将侧栏主机拖入分组" />

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
import DistroLogo from "@/components/DistroLogo.vue";
import { api } from "@/api";
import { Events } from "@wailsio/runtime";
import { useAppStore, UNGROUPED_ID } from "@/stores/app";
import { useAgentInstallStore } from "@/stores/agentInstall";
import {
  clearHostWecom,
  fireHostWecom,
  hostWecomKindFromKey,
} from "@/utils/wecomHostAlerts";
import { formatBytes, formatErr, formatMemCapacity, isAgentMissing } from "@/utils/format";
import {
  ALERT,
  diskLowMessage,
  isCpuAlert,
  isDiskLow,
  isLoadAlert,
  isMemAlert,
  pickRootDisk,
} from "@/utils/alerts";
import type { agentcli, monitor, sshconfig } from "@/api";

const props = defineProps<{
  groupId: string;
  groupName: string;
}>();

const app = useAppStore();
const agentInstall = useAgentInstallStore();

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

/** 当前组内主机列表（来自 store 的 groups.json + hosts.json：同步可用，立即渲染） */
const hosts = computed<sshconfig.HostConfig[]>(() => {
  const node = app.groupNodes.find(
    (n) => (n.group?.id ?? UNGROUPED_ID) === props.groupId
  );
  return node?.hosts ?? [];
});

/** 每主机独立的指标状态：key=host.name */
const hostStates = ref<Record<string, HostSnap>>({});

/** 当前活跃组 id，防止旧组请求覆盖新组 */
let activeGroupId = props.groupId;
const inFlight = new Set<string>();
let prevAlertKeys = new Set<string>();
let pollTimer: ReturnType<typeof setInterval> | null = null;

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

function diskPercent(disks?: monitor.DiskInfo[]): number {
  return pickRootDisk(disks)?.percent ?? 0;
}

function memUsage(ov: monitor.Overview | undefined): string {
  if (!ov) return "—";
  return `${formatBytes(ov.memUsed || 0)} / ${formatMemCapacity(ov.memTotal || 0)}`;
}

/** 规格：如「8核32G」 */
function hostSpec(ov: monitor.Overview): string {
  const cores = ov.cpuCount || 0;
  return `${cores}核${formatMemCapacity(ov.memTotal || 0)}`;
}

function diskUsage(disks?: monitor.DiskInfo[]): string | undefined {
  const d = pickRootDisk(disks);
  if (!d) return undefined;
  return `${formatBytes(d.used || 0)} / ${formatBytes(d.total || 0)}`;
}

function isHostAlert(s: HostSnap): boolean {
  if (s.error || !s.overview) return false;
  const ov = s.overview;
  if (isCpuAlert(ov) || isMemAlert(ov) || isLoadAlert(ov)) return true;
  if (isDiskLow(s.disks)) return true;
  return false;
}

const okCount = computed(
  () => hosts.value.filter((h) => {
    const s = hostState(h.name);
    return !!s.overview && !s.error && !isHostAlert(s);
  }).length
);
const alertCount = computed(
  () => hosts.value.filter((h) => {
    const s = hostState(h.name);
    return !s.error && isHostAlert(s);
  }).length
);
const errCount = computed(
  () =>
    hosts.value.filter((h) => {
      const e = hostState(h.name).error;
      return !!e && !isAgentMissing(e);
    }).length
);

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
    const [ov, disks] = await Promise.all([
      api.collectOverview(name),
      api.collectDisks(name),
    ]);
    if (activeGroupId !== props.groupId) return;
    hostStates.value[name] = { loading: false, overview: ov, disks: disks ?? [], error: undefined };
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
    if (isAgentMissing(s.error)) return [];
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
        newLines.push(a.line);
        const kind = hostWecomKindFromKey(a.key);
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
  if (!st?.ok) return { type: "info", text: "未装/离线" };
  if (latestAgentVersion.value && st.version !== latestAgentVersion.value) {
    return { type: "warning", text: `v${st.version} 可更新` };
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
  },
  { immediate: true }
);

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

onBeforeUnmount(() => {
  stopPoll();
  unbindBatchProgress();
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
        const d = pickRootDisk(p.disks)?.percent ?? 0;
        value = d;
        display = `${d.toFixed(1)}%`;
        alert = isDiskLow(p.disks);
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
  min-height: 200px;
  box-sizing: border-box;
}

.group-stats {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.page-toolbar__actions {
  margin-left: auto;
}

/* 工具栏操作：统一 32px 满圆角 outlined，避免图标按钮与文字按钮高低不一 */
.group-toolbar-btn {
  height: 32px !important;
  min-height: 32px !important;
  padding: 0 16px !important;
  border-radius: var(--m3-shape-full) !important;
  font: var(--m3-label-large) !important;
  font-weight: 500 !important;
  background: var(--m3-surface-container-lowest);
  border-color: var(--m3-outline-variant);
  color: var(--m3-primary);

  &--icon {
    padding: 0 !important;
    width: 32px !important;
    min-width: 32px !important;
  }

  &:hover,
  &:focus {
    background: color-mix(in srgb, var(--m3-primary) 8%, transparent);
    border-color: var(--m3-outline);
    color: var(--m3-primary);
  }

  :deep(.el-icon) {
    font-size: 16px;
  }
}

.group-stat-chip {
  height: 32px !important;
  min-height: 32px !important;
  padding: 0 16px !important;
  border-radius: var(--m3-shape-full) !important;
  font: var(--m3-label-large) !important;
  font-weight: 500 !important;
  line-height: 30px !important;
  box-sizing: border-box;
}

.group-status-chip {
  height: 24px;
  padding: 0 10px;
  border-radius: var(--m3-shape-full) !important;
  font: var(--m3-label-medium);
  font-weight: 500;
}

.host-list-wrap {
  overflow: hidden;
}

.host-list-table {
  width: 100%;
  cursor: pointer;

  :deep(.group-index-col .cell) {
    overflow: visible;
    text-overflow: clip;
    font-variant-numeric: tabular-nums;
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
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}
.list-os-ico {
  display: inline-flex;
  width: 22px;
  height: 22px;
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
  gap: 4px;
  padding-right: 8px;
}
:deep(.list-metric-nums) {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-variant-numeric: tabular-nums;
}
:deep(.list-metric-val) {
  font-size: 13px;
  font-weight: 600;
  &.is-alert {
    color: var(--m3-error) !important;
    font-weight: 700;
  }
}
:deep(.list-metric-sub) {
  font-size: 12px;
  color: var(--m3-on-surface-variant);
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
