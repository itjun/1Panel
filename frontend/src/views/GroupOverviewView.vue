<template>
  <div v-loading="loading && !group" class="group-overview">
    <el-alert
      v-if="error && !group"
      type="error"
      :title="error"
      show-icon
      class="mb"
    />

    <template v-if="group">
      <!-- ===== 日常模式工具栏 ===== -->
      <div class="summary-bar">
        <div class="summary-left">
          <span class="panel-section-title">主机监控</span>
          <span class="meta">共 {{ hosts.length }} 台</span>
          <el-tag size="small" type="success" effect="plain">
            正常 {{ okCount }}
          </el-tag>
          <el-tag
            v-if="alertCount > 0"
            size="small"
            type="danger"
            effect="dark"
          >
            告警 {{ alertCount }}
          </el-tag>
          <el-tag
            v-if="errCount > 0"
            size="small"
            type="danger"
            effect="plain"
          >
            失败 {{ errCount }}
          </el-tag>
        </div>
        <div class="summary-right">
          <el-radio-group
            v-model="viewMode"
            size="small"
            class="view-switch"
            @change="persistViewMode"
          >
            <el-radio-button value="card">
              <span class="view-opt">
                <el-icon><Grid /></el-icon>
                卡片
              </span>
            </el-radio-button>
            <el-radio-button value="list">
              <span class="view-opt">
                <el-icon><List /></el-icon>
                列表
              </span>
            </el-radio-button>
          </el-radio-group>
          <el-button
            link
            type="primary"
            :icon="Refresh"
            :loading="loading"
            @click="load"
          >
            刷新
          </el-button>
          <el-button
            type="primary"
            size="small"
            :icon="Monitor"
            @click="enterDashboard()"
          >
            看板
          </el-button>
          <el-tooltip content="看板 + 系统全屏 (F11)" placement="bottom">
            <el-button
              size="small"
              :icon="FullScreen"
              @click="enterDashboard({ systemFullscreen: true })"
            >
              全屏
            </el-button>
          </el-tooltip>
        </div>
      </div>

      <el-empty
        v-if="hosts.length === 0"
        description="该分组暂无主机，可将侧栏主机拖入分组"
      />

      <!-- ===== 日常：卡片 ===== -->
      <div v-else-if="viewMode === 'card'" class="host-grid">
        <div
          v-for="h in hosts"
          :key="'c-' + h.name"
          class="host-card panel-hover-card"
          :class="cardClass(h)"
          @click="openHost(h.name)"
        >
          <HostCardBody :host="h" />
        </div>
      </div>

      <!-- ===== 日常：列表 ===== -->
      <div v-else class="host-list-wrap panel-hover-card">
        <el-table
          :data="hosts"
          size="default"
          stripe
          class="host-list-table"
          :row-class-name="tableRowClass"
          @row-click="(row: HostSnap) => openHost(row.name)"
        >
          <el-table-column label="状态" width="78" fixed>
            <template #default="{ row }">
              <el-tag
                size="small"
                :type="statusTagType(row)"
                effect="light"
                round
              >
                {{ statusLabel(row) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column
            label="主机"
            min-width="150"
            fixed
            show-overflow-tooltip
          >
            <template #default="{ row }">
              <div class="list-host-name">
                <span class="list-os-ico">
                  <el-icon v-if="row.error" :size="18" color="#f56c6c">
                    <WarningFilled />
                  </el-icon>
                  <DistroLogo
                    v-else
                    :os-release="row.overview?.osRelease || ''"
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
          <el-table-column label="用户" width="88" show-overflow-tooltip>
            <template #default="{ row }">
              {{ row.user || "—" }}
            </template>
          </el-table-column>
          <el-table-column label="系统" min-width="120" show-overflow-tooltip>
            <template #default="{ row }">
              <template v-if="row.error">—</template>
              <div v-else class="list-os-cell">
                <DistroLogo
                  :os-release="row.overview?.osRelease || ''"
                  :size="16"
                />
                <span>{{
                  shortOs(row.overview?.osRelease || "") || "Linux"
                }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="CPU 核" width="78" align="right">
            <template #default="{ row }">
              <template v-if="row.error || !row.overview">—</template>
              <template v-else>{{ row.overview.cpuCount || 0 }}</template>
            </template>
          </el-table-column>
          <el-table-column label="内存总量" width="100" align="right">
            <template #default="{ row }">
              <template v-if="row.error || !row.overview">—</template>
              <template v-else>
                {{ formatBytes(row.overview.memTotal || 0) }}
              </template>
            </template>
          </el-table-column>
          <el-table-column label="CPU" min-width="150">
            <template #default="{ row }">
              <template v-if="row.error || !row.overview">
                <span class="err-text list-err" :title="row.error">{{
                  row.error || "—"
                }}</span>
              </template>
              <ListMetric
                v-else
                :percent="row.overview.cpuPercent || 0"
                :alert="(row.overview.cpuPercent || 0) > THRESHOLDS.cpu"
                :text="`${(row.overview.cpuPercent || 0).toFixed(1)}%`"
              />
            </template>
          </el-table-column>
          <el-table-column label="内存" min-width="170">
            <template #default="{ row }">
              <template v-if="row.error || !row.overview">—</template>
              <ListMetric
                v-else
                :percent="row.overview.memPercent || 0"
                :alert="(row.overview.memPercent || 0) > THRESHOLDS.mem"
                :text="`${(row.overview.memPercent || 0).toFixed(1)}%`"
                :sub="formatBytes(row.overview.memUsed || 0)"
              />
            </template>
          </el-table-column>
          <el-table-column label="磁盘 /" min-width="170">
            <template #default="{ row }">
              <template v-if="row.error">—</template>
              <ListMetric
                v-else
                :percent="diskPercent(row)"
                :alert="diskPercent(row) > THRESHOLDS.disk"
                :text="`${diskPercent(row).toFixed(1)}%`"
                :sub="diskUsed(row) || '—'"
              />
            </template>
          </el-table-column>
          <el-table-column label="负载" min-width="120" align="right">
            <template #default="{ row }">
              <template v-if="row.error || !row.overview">—</template>
              <span
                v-else
                class="load-cell"
                :class="{ 'is-alert': isLoadAlert(row) }"
              >
                <span class="mono">{{
                  (row.overview.load1 || 0).toFixed(2)
                }}</span>
                <span class="load-sep">/</span>
                <span class="load-cores">{{ row.overview.cpuCount || 0 }}</span>
              </span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="80" fixed="right" align="center">
            <template #default="{ row }">
              <el-button
                link
                type="primary"
                size="small"
                @click.stop="openHost(row.name)"
              >
                打开
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </template>

    <!-- ===== 看板模式：纯壳，Teleport 盖住全应用 ===== -->
    <Teleport to="body">
      <div
        v-if="isDashboard && group"
        class="group-dashboard"
        :class="{ 'has-alerts': alertHosts.length > 0 }"
      >
        <header class="dash-header">
          <div class="dash-header-left">
            <span class="dash-title">{{ groupName || group.groupName }}</span>
            <span class="dash-badge">看板</span>
            <span class="dash-meta">共 {{ hosts.length }} 台</span>
            <el-tag size="small" type="success" effect="dark" round>
              正常 {{ okCount }}
            </el-tag>
            <el-tag
              v-if="alertHosts.length > 0"
              size="small"
              type="danger"
              effect="dark"
              round
              class="dash-alert-tag"
            >
              告警 {{ alertHosts.length }}
            </el-tag>
            <span class="dash-hint">
              每 5 秒刷新 · 有告警持续响铃 · 双击主机进入 ·
              <kbd>F11</kbd> 全屏 ·
              <kbd>Esc</kbd> 退出
            </span>
          </div>
          <div class="dash-header-right">
            <el-button
              size="small"
              :type="soundMuted ? 'warning' : 'default'"
              :plain="!soundMuted"
              @click="toggleMute"
            >
              {{ soundMuted ? "已静音" : "声音开" }}
            </el-button>
            <el-button
              size="small"
              :type="sysFullscreen ? 'primary' : 'default'"
              plain
              :icon="sysFullscreen ? Close : FullScreen"
              @click="toggleSysFullscreen"
            >
              {{ sysFullscreen ? "退出系统全屏" : "系统全屏" }}
            </el-button>
            <el-button
              size="small"
              :icon="Refresh"
              :loading="loading"
              @click="load"
            >
              刷新
            </el-button>
            <el-button size="small" type="primary" plain @click="exitDashboard">
              退出看板
            </el-button>
          </div>
        </header>

        <div v-if="hosts.length === 0" class="dash-empty">
          <el-empty description="该分组暂无主机" />
        </div>

        <div v-else class="dash-body">
          <!-- 告警区 -->
          <section v-if="alertHosts.length > 0" class="dash-zone dash-zone--alert">
            <div class="zone-head">
              <span class="zone-title danger">告警</span>
              <span class="zone-count">{{ alertHosts.length }} 台</span>
            </div>
            <div class="dash-grid">
              <div
                v-for="h in alertHosts"
                :key="'da-' + h.name"
                class="dash-card is-alarm"
                title="双击打开主机"
                @dblclick="openHostFromDash(h.name)"
              >
                <HostCardBody :host="h" large />
              </div>
            </div>
          </section>

          <!-- 正常区 -->
          <section class="dash-zone dash-zone--ok">
            <div class="zone-head">
              <span class="zone-title">正常运行</span>
              <span class="zone-count">{{ normalHosts.length }} 台</span>
            </div>
            <div v-if="normalHosts.length === 0" class="zone-empty">
              当前无正常主机
            </div>
            <div v-else class="dash-grid">
              <div
                v-for="h in normalHosts"
                :key="'dn-' + h.name"
                class="dash-card"
                title="双击打开主机"
                @dblclick="openHostFromDash(h.name)"
              >
                <HostCardBody :host="h" large />
              </div>
            </div>
          </section>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import {
  Close,
  FullScreen,
  Grid,
  List,
  Monitor,
  Refresh,
  WarningFilled,
} from "@element-plus/icons-vue";
import { ElNotification, ElProgress } from "element-plus";
import {
  WindowFullscreen,
  WindowUnfullscreen,
} from "@wailsjs/runtime/runtime";
import DistroLogo from "@/components/DistroLogo.vue";
import { api } from "@/api";
import { useAppStore } from "@/stores/app";
import { formatBytes } from "@/utils/format";
import type { monitor } from "@wailsjs/go/models";

const props = defineProps<{
  groupId: string;
  groupName: string;
}>();

const app = useAppStore();

const THRESHOLDS = {
  cpu: 80,
  mem: 85,
  disk: 90,
  loadRatio: 1.0,
};
const POLL_MS = 5000;
/** 有告警时循环响铃间隔 */
const SIREN_MS = 2500;
const VIEW_KEY = "ipannel.groupViewMode";
const MUTE_KEY = "ipannel.groupDashMute";

type ViewMode = "card" | "list";

interface HostSnap {
  name: string;
  hostName: string;
  user: string;
  overview: monitor.Overview;
  disks: monitor.DiskInfo[];
  error?: string;
}

interface GroupSnap {
  groupId: string;
  groupName: string;
  hosts: HostSnap[];
}

function loadViewMode(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === "list" || v === "card") return v;
  } catch {
    /* ignore */
  }
  return "card";
}

function loadMute(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

const viewMode = ref<ViewMode>(loadViewMode());
const isDashboard = ref(false);
const sysFullscreen = ref(false);
const soundMuted = ref(loadMute());
const group = ref<GroupSnap | null>(null);
const loading = ref(false);
const error = ref("");

let timer: ReturnType<typeof setInterval> | null = null;
let sirenTimer: ReturnType<typeof setInterval> | null = null;
let seq = 0;
let prevAlertKeys = new Set<string>();
let audioCtx: AudioContext | null = null;
/** 防止上一声未结束又叠太多 */
let beepBusy = false;

const hosts = computed(() => group.value?.hosts || []);

const alertHosts = computed(() =>
  hosts.value.filter((h) => !!h.error || isHostAlert(h))
);
const normalHosts = computed(() =>
  hosts.value.filter((h) => !h.error && !isHostAlert(h))
);

const okCount = computed(() => normalHosts.value.length);
const alertCount = computed(
  () => hosts.value.filter((h) => !h.error && isHostAlert(h)).length
);
const errCount = computed(() => hosts.value.filter((h) => !!h.error).length);

function persistViewMode() {
  try {
    localStorage.setItem(VIEW_KEY, viewMode.value);
  } catch {
    /* ignore */
  }
}

function persistMute() {
  try {
    localStorage.setItem(MUTE_KEY, soundMuted.value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function toggleMute() {
  soundMuted.value = !soundMuted.value;
  persistMute();
  // 取消静音时解锁 + 试听，并按是否有告警启停循环响铃
  if (!soundMuted.value) {
    void unlockAndBeep(true).then(() => syncSiren());
  } else {
    stopSiren();
  }
}

// ---------- 看板 / 系统全屏 ----------

function setWindowFullscreen(on: boolean) {
  try {
    if (on) WindowFullscreen();
    else WindowUnfullscreen();
  } catch {
    /* 无 Wails runtime */
  }
}

function enterDashboard(opts?: { systemFullscreen?: boolean }) {
  const wantSysFs = !!opts?.systemFullscreen;
  isDashboard.value = true;
  document.body.classList.add("group-dash-lock");
  // 必须在用户手势里解锁音频（WKWebView 自动播放策略）
  void unlockAndBeep(false).then(() => syncSiren());
  if (wantSysFs) {
    sysFullscreen.value = true;
    setWindowFullscreen(true);
  }
  // 按钮进入默认不系统全屏；F11 进入时带系统全屏
}

function exitDashboard() {
  if (!isDashboard.value) return;
  isDashboard.value = false;
  if (sysFullscreen.value) {
    sysFullscreen.value = false;
    setWindowFullscreen(false);
  }
  document.body.classList.remove("group-dash-lock");
  // 退出看板后仍保持「有警告就响」，不在这里 stopSiren
}

function toggleSysFullscreen() {
  if (!isDashboard.value) return;
  sysFullscreen.value = !sysFullscreen.value;
  setWindowFullscreen(sysFullscreen.value);
}

/** F11：直接进入看板 + 系统全屏；再按退出 */
function onF11Toggle(e: KeyboardEvent) {
  e.preventDefault();
  e.stopPropagation();
  if (isDashboard.value && sysFullscreen.value) {
    // 已在全屏看板 → 退出
    exitDashboard();
    return;
  }
  if (isDashboard.value && !sysFullscreen.value) {
    // 已在看板但未系统全屏 → 补上系统全屏
    sysFullscreen.value = true;
    setWindowFullscreen(true);
    return;
  }
  // 日常分组页 → 一键看板全屏
  enterDashboard({ systemFullscreen: true });
}

function onDashKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && isDashboard.value) {
    e.preventDefault();
    e.stopPropagation();
    exitDashboard();
    return;
  }
  // F11 / Fn+F11（部分键盘 key 为 "F11"）；忽略输入框内（侧栏搜索）
  if (e.key === "F11" || e.code === "F11") {
    const t = e.target as HTMLElement | null;
    const tag = (t?.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || t?.isContentEditable) {
      return;
    }
    onF11Toggle(e);
  }
}

function openHost(name: string) {
  app.openHostTab(name);
}

function openHostFromDash(name: string) {
  exitDashboard();
  app.openHostTab(name);
}

// ---------- 指标 / 告警 ----------

function diskPercent(h: HostSnap): number {
  return h.disks?.[0]?.percent ?? 0;
}

function diskUsed(h: HostSnap): string | undefined {
  const d = h.disks?.[0];
  if (!d) return undefined;
  return formatBytes(d.used || 0);
}

function loadBar(h: HostSnap): number {
  const n = h.overview?.cpuCount || 0;
  const load1 = h.overview?.load1 || 0;
  if (n <= 0) return 0;
  return Math.min(100, (load1 / n) * 50);
}

function isLoadAlert(h: HostSnap): boolean {
  const n = h.overview?.cpuCount || 0;
  const load1 = h.overview?.load1 || 0;
  return n > 0 && load1 / n > THRESHOLDS.loadRatio;
}

function isHostAlert(h: HostSnap): boolean {
  if (h.error) return false;
  const ov = h.overview;
  if (!ov) return false;
  if ((ov.cpuPercent || 0) > THRESHOLDS.cpu) return true;
  if ((ov.memPercent || 0) > THRESHOLDS.mem) return true;
  if (diskPercent(h) > THRESHOLDS.disk) return true;
  if (isLoadAlert(h)) return true;
  return false;
}

function collectHostAlerts(h: HostSnap): { key: string; line: string }[] {
  if (h.error) {
    return [
      {
        key: `${h.name}|conn`,
        line: `「${h.name}」连接失败：${h.error}`,
      },
    ];
  }
  const ov = h.overview;
  if (!ov) return [];
  const out: { key: string; line: string }[] = [];
  const cpu = ov.cpuPercent || 0;
  if (cpu > THRESHOLDS.cpu) {
    out.push({
      key: `${h.name}|cpu`,
      line: `「${h.name}」CPU ${cpu.toFixed(1)}% 超过 ${THRESHOLDS.cpu}%`,
    });
  }
  const mem = ov.memPercent || 0;
  if (mem > THRESHOLDS.mem) {
    out.push({
      key: `${h.name}|mem`,
      line: `「${h.name}」内存 ${mem.toFixed(1)}% 超过 ${THRESHOLDS.mem}%`,
    });
  }
  const disk = diskPercent(h);
  if (disk > THRESHOLDS.disk) {
    out.push({
      key: `${h.name}|disk`,
      line: `「${h.name}」磁盘 ${disk.toFixed(1)}% 超过 ${THRESHOLDS.disk}%`,
    });
  }
  if (isLoadAlert(h)) {
    const cores = ov.cpuCount || 0;
    const load1 = ov.load1 || 0;
    out.push({
      key: `${h.name}|load`,
      line: `「${h.name}」负载 ${load1.toFixed(2)} / ${cores} 核 超过警戒`,
    });
  }
  return out;
}

/** 获取可用 AudioContext 构造器 */
function getAudioContextCtor(): typeof AudioContext | null {
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return w.AudioContext || w.webkitAudioContext || null;
}

/** 用户手势内解锁音频（Wails/WKWebView 必需） */
async function unlockAudio(): Promise<boolean> {
  try {
    const AC = getAudioContextCtor();
    if (!AC) return false;
    if (!audioCtx || audioCtx.state === "closed") {
      audioCtx = new AC();
    }
    if (audioCtx.state === "suspended") {
      await audioCtx.resume();
    }
    // 极短静音缓冲，进一步「点亮」部分 WebView 音频管线
    if (audioCtx.state === "running") {
      const buf = audioCtx.createBuffer(1, 1, 22050);
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      src.connect(audioCtx.destination);
      src.start(0);
    }
    return audioCtx.state === "running";
  } catch {
    return false;
  }
}

/** 生成双音短 beep 的 WAV Blob URL（HTMLAudio 回退，兼容性更好） */
function buildBeepWavUrl(): string {
  const sampleRate = 22050;
  const freqs = [880, 1175];
  const toneSec = 0.11;
  const gapSec = 0.04;
  const totalSec = freqs.length * toneSec + (freqs.length - 1) * gapSec;
  const n = Math.floor(sampleRate * totalSec);
  const data = new Int16Array(n);
  let offset = 0;
  for (let t = 0; t < freqs.length; t++) {
    const len = Math.floor(sampleRate * toneSec);
    const f = freqs[t];
    for (let i = 0; i < len && offset + i < n; i++) {
      const env = Math.min(1, i / (sampleRate * 0.01), (len - i) / (sampleRate * 0.02));
      const sample = Math.sin((2 * Math.PI * f * i) / sampleRate) * env * 0.55;
      data[offset + i] = (sample * 0x7fff) | 0;
    }
    offset += len + Math.floor(sampleRate * gapSec);
  }
  const bytes = data.byteLength;
  const buf = new ArrayBuffer(44 + bytes);
  const view = new DataView(buf);
  const writeStr = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + bytes, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, bytes, true);
  new Uint8Array(buf, 44).set(new Uint8Array(data.buffer));
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

async function playBeepViaWebAudio(): Promise<boolean> {
  try {
    const ok = await unlockAudio();
    if (!ok || !audioCtx) return false;
    const ctx = audioCtx;
    const now = ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = i === 0 ? 880 : 1175;
      const t0 = now + i * 0.15;
      // 线性包络更稳（部分实现 exponential 对 0 敏感）
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.25, t0 + 0.015);
      gain.gain.linearRampToValueAtTime(0, t0 + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.13);
    }
    return true;
  } catch {
    return false;
  }
}

async function playBeepViaHtmlAudio(): Promise<boolean> {
  try {
    const url = buildBeepWavUrl();
    const audio = new Audio(url);
    audio.volume = 0.7;
    await audio.play();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  } catch {
    return false;
  }
}

/** 告警音：优先 WebAudio，失败则 HTMLAudio WAV */
async function playAlertBeep() {
  if (soundMuted.value) return;
  if (beepBusy) return;
  beepBusy = true;
  try {
    const a = await playBeepViaWebAudio();
    if (!a) await playBeepViaHtmlAudio();
  } finally {
    window.setTimeout(() => {
      beepBusy = false;
    }, 400);
  }
}

/** 解锁；optionally 立刻响一声（取消静音试听） */
async function unlockAndBeep(forceBeep: boolean) {
  await unlockAudio();
  // 再尝试一次 HTML 管线解锁
  try {
    const url = buildBeepWavUrl();
    const audio = new Audio(url);
    audio.volume = forceBeep && !soundMuted.value ? 0.7 : 0.001;
    await audio.play().catch(() => undefined);
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch {
    /* ignore */
  }
  if (forceBeep && !soundMuted.value) {
    await playAlertBeep();
  }
}

function hasActiveAlerts(list: HostSnap[] = hosts.value): boolean {
  return list.some((h) => !!h.error || isHostAlert(h));
}

function stopSiren() {
  if (sirenTimer) {
    clearInterval(sirenTimer);
    sirenTimer = null;
  }
}

/**
 * 有警告就一直响：存在告警且未静音时，按间隔循环 beep；
 * 全部恢复或静音后停止。
 */
function syncSiren() {
  if (soundMuted.value || !hasActiveAlerts()) {
    stopSiren();
    return;
  }
  if (sirenTimer) return;
  // 立即响一声，再进入循环
  void playAlertBeep();
  sirenTimer = setInterval(() => {
    if (soundMuted.value || !hasActiveAlerts()) {
      stopSiren();
      return;
    }
    void playAlertBeep();
  }, SIREN_MS);
}

function notifyNewAlerts(list: HostSnap[]) {
  const next = new Set<string>();
  const newLines: string[] = [];
  for (const h of list) {
    for (const a of collectHostAlerts(h)) {
      next.add(a.key);
      if (!prevAlertKeys.has(a.key)) {
        newLines.push(a.line);
      }
    }
  }
  prevAlertKeys = next;
  // 声音交给 syncSiren 持续响；弹窗仅在新出现的告警时
  if (newLines.length === 0) return;

  const title =
    newLines.length === 1
      ? "主机告警"
      : `主机告警（${newLines.length} 项）`;
  const body =
    newLines.length <= 6
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

function applyHostData(data: GroupSnap) {
  const list = data.hosts || [];
  group.value = {
    groupId: data.groupId,
    groupName: data.groupName,
    hosts: list,
  };
  notifyNewAlerts(list);
  syncSiren();
}

function statusLabel(h: HostSnap): string {
  if (h.error) return "失败";
  if (isHostAlert(h)) return "告警";
  return "正常";
}

function statusTagType(h: HostSnap): "success" | "danger" {
  if (h.error || isHostAlert(h)) return "danger";
  return "success";
}

function cardClass(h: HostSnap) {
  return {
    "is-error": !!h.error,
    "is-alert": !h.error && isHostAlert(h),
  };
}

function tableRowClass({ row }: { row: HostSnap }) {
  if (row.error || isHostAlert(row)) return "host-list-row is-danger-row";
  return "host-list-row";
}

function shortOs(osRelease: string): string {
  const s = (osRelease || "").trim();
  if (!s) return "";
  const m = s.match(/^([A-Za-z]+)/);
  return m ? m[1] : s.slice(0, 16);
}

function formatErr(e: unknown): string {
  if (e == null) return "未知错误";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message || String(e);
  const any = e as { message?: string };
  if (any.message) return any.message;
  return String(e);
}

async function load() {
  if (!props.groupId) return;
  const my = ++seq;
  loading.value = true;
  try {
    const data = (await api.listOneGroupOverview(props.groupId)) as GroupSnap;
    if (my !== seq) return;
    applyHostData(data);
    error.value = "";
  } catch (e) {
    if (my !== seq) return;
    error.value = formatErr(e);
  } finally {
    if (my === seq) loading.value = false;
  }
}

function startPoll() {
  stopPoll();
  timer = setInterval(() => {
    void loadQuiet();
  }, POLL_MS);
}

async function loadQuiet() {
  if (!props.groupId || document.hidden) return;
  const my = ++seq;
  try {
    const data = (await api.listOneGroupOverview(props.groupId)) as GroupSnap;
    if (my !== seq) return;
    applyHostData(data);
    error.value = "";
  } catch {
    /* 静默 */
  }
}

function stopPoll() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// ---------- 子组件：卡片内容（日常 / 看板复用） ----------

const HostCardBody = defineComponent({
  name: "HostCardBody",
  props: {
    host: { type: Object as () => HostSnap, required: true },
    large: { type: Boolean, default: false },
  },
  setup(p) {
    return () => {
      const hst = p.host;
      const alert = !!hst.error || isHostAlert(hst);
      const ov = hst.overview;
      return h(
        "div",
        { class: ["hcb", p.large ? "hcb--large" : "", alert ? "hcb--alarm" : ""] },
        [
          h("span", {
            class: [
              "status-dot",
              hst.error ? "err" : alert ? "alert" : "ok",
            ],
            title: hst.error
              ? "连接失败"
              : alert
                ? "存在告警"
                : "正常",
          }),
          h("div", { class: "card-top" }, [
            h(
              "div",
              { class: ["avatar", hst.error ? "err" : ""] },
              hst.error
                ? h(
                    "span",
                    { class: "avatar-warn" },
                    h(WarningFilled, { style: { width: "22px", height: "22px" } })
                  )
                : h(DistroLogo, {
                    osRelease: ov?.osRelease || "",
                    size: p.large ? 30 : 26,
                  })
            ),
            h("div", { class: "id-block" }, [
              h("div", { class: "host-name", title: hst.name }, hst.name),
              h(
                "div",
                {
                  class: "host-sub",
                  title: hst.error
                    ? hst.error
                    : `${hst.user || "?"}@${hst.hostName || "?"}`,
                },
                hst.error
                  ? h("span", { class: "err-text" }, hst.error)
                  : `${hst.user || "?"}@${hst.hostName || "?"}`
              ),
              !hst.error && ov
                ? h(
                    "div",
                    { class: "host-meta" },
                    `${ov.cpuCount || 0} 核 · ${formatBytes(ov.memTotal || 0)}${
                      ov.osRelease ? ` · ${shortOs(ov.osRelease)}` : ""
                    }`
                  )
                : null,
            ]),
          ]),
          !hst.error && ov
            ? h("div", { class: "metrics" }, [
                metricRow(
                  "CPU",
                  ov.cpuPercent || 0,
                  (ov.cpuPercent || 0) > THRESHOLDS.cpu,
                  `${(ov.cpuPercent || 0).toFixed(1)}%`
                ),
                metricRow(
                  "MEM",
                  ov.memPercent || 0,
                  (ov.memPercent || 0) > THRESHOLDS.mem,
                  `${(ov.memPercent || 0).toFixed(1)}%`,
                  formatBytes(ov.memUsed || 0)
                ),
                metricRow(
                  "DISK",
                  diskPercent(hst),
                  diskPercent(hst) > THRESHOLDS.disk,
                  `${diskPercent(hst).toFixed(1)}%`,
                  diskUsed(hst)
                ),
                metricRow(
                  "LOAD",
                  loadBar(hst),
                  isLoadAlert(hst),
                  (ov.load1 || 0).toFixed(2),
                  `/ ${ov.cpuCount || 0}`
                ),
              ])
            : hst.error
              ? h(
                  "div",
                  { class: "card-footer-hint" },
                  p.large ? "双击打开后可重试连接" : "点击打开后可重试连接"
                )
              : null,
        ]
      );
    };
  },
});

function metricRow(
  label: string,
  percent: number,
  alert: boolean,
  display: string,
  sub?: string
) {
  return h("div", { class: ["metric-row", alert ? "is-alert" : ""] }, [
    h("span", { class: "m-label" }, label),
    h(
      "span",
      { class: "m-bar" },
      h(ElProgress, {
        percentage: Math.min(100, Math.max(0, percent || 0)),
        strokeWidth: 6,
        showText: false,
        color: alert ? "var(--el-color-danger)" : "var(--el-color-primary)",
      })
    ),
    h("span", { class: ["m-val", alert ? "is-alert" : ""] }, display),
    sub
      ? h("span", { class: "m-sub" }, sub)
      : h("span", { class: "m-sub empty" }, ""),
  ]);
}

const ListMetric = defineComponent({
  name: "ListMetric",
  props: {
    percent: { type: Number, required: true },
    alert: { type: Boolean, default: false },
    text: { type: String, required: true },
    sub: { type: String, default: undefined },
  },
  setup(p) {
    return () =>
      h("div", { class: "list-metric" }, [
        h(
          "div",
          { class: "list-metric-bar" },
          h(ElProgress, {
            percentage: Math.min(100, Math.max(0, p.percent || 0)),
            strokeWidth: 8,
            showText: false,
            color: p.alert
              ? "var(--el-color-danger)"
              : "var(--el-color-primary)",
          })
        ),
        h("div", { class: "list-metric-nums" }, [
          h(
            "span",
            { class: ["list-metric-val", p.alert ? "is-alert" : ""] },
            p.text
          ),
          p.sub ? h("span", { class: "list-metric-sub" }, p.sub) : null,
        ]),
      ]);
  },
});

onMounted(() => {
  window.addEventListener("keydown", onDashKeydown, true);
  void load().then(startPoll);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onDashKeydown, true);
  exitDashboard();
  stopSiren();
  stopPoll();
  seq++;
  if (audioCtx && audioCtx.state !== "closed") {
    void audioCtx.close().catch(() => undefined);
    audioCtx = null;
  }
});

watch(
  () => props.groupId,
  () => {
    exitDashboard();
    group.value = null;
    error.value = "";
    prevAlertKeys = new Set();
    stopSiren();
    void load().then(startPoll);
  }
);
</script>

<style scoped lang="scss">
.group-overview {
  min-height: 200px;
  box-sizing: border-box;
}
.mb {
  margin-bottom: 12px;
}
.summary-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.summary-left,
.summary-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.meta {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.view-opt {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.view-switch :deep(.el-radio-button__inner) {
  padding: 6px 12px;
}

/* ---------- 日常卡片 ---------- */
.host-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}
.host-card {
  position: relative;
  padding: 14px 14px 12px;
  background: var(--el-bg-color, #fff);
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  &:hover {
    transform: translateY(-1px);
  }
  &.is-error,
  &.is-alert {
    border-color: var(--el-color-danger) !important;
    box-shadow: 0 0 0 1px var(--el-color-danger);
  }
}

/* HostCardBody */
:deep(.hcb) {
  position: relative;
}
:deep(.status-dot) {
  position: absolute;
  top: 0;
  right: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  &.ok {
    background: #67c23a;
    box-shadow: 0 0 0 2px rgba(103, 194, 58, 0.2);
  }
  &.alert,
  &.err {
    background: #f56c6c;
    box-shadow: 0 0 0 2px rgba(245, 108, 108, 0.25);
  }
}
:deep(.card-top) {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  min-width: 0;
  padding-right: 14px;
}
:deep(.avatar) {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--el-color-primary-light-9, #ecf5ff);
  color: var(--el-color-primary);
  &.err {
    background: var(--el-color-danger-light-9, #fef0f0);
    color: var(--el-color-danger);
  }
}
:deep(.avatar-warn) {
  display: flex;
  color: var(--el-color-danger);
}
:deep(.id-block) {
  min-width: 0;
  flex: 1;
}
:deep(.host-name) {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:deep(.host-sub) {
  margin-top: 2px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:deep(.err-text) {
  color: var(--el-color-danger);
}
:deep(.host-meta) {
  margin-top: 2px;
  font-size: 11px;
  color: var(--el-text-color-placeholder, #a8abb2);
}
:deep(.metrics) {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
:deep(.card-footer-hint) {
  margin-top: 12px;
  font-size: 11px;
  color: var(--el-text-color-placeholder);
}
:deep(.metric-row) {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}
:deep(.m-label) {
  width: 34px;
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
}
:deep(.metric-row.is-alert .m-label) {
  color: var(--el-color-danger);
  font-weight: 600;
}
:deep(.m-bar) {
  flex: 1;
  min-width: 0;
}
:deep(.m-val) {
  width: 44px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
  &.is-alert {
    color: var(--el-color-danger) !important;
    font-weight: 700;
  }
}
:deep(.m-sub) {
  width: 56px;
  text-align: right;
  font-size: 10px;
  color: var(--el-text-color-placeholder);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  &.empty {
    visibility: hidden;
  }
}
:deep(.hcb--large .host-name) {
  font-size: 16px;
}
:deep(.hcb--large .host-sub) {
  font-size: 12px;
}
:deep(.hcb--large .avatar) {
  width: 52px;
  height: 52px;
}
:deep(.hcb--large .metric-row) {
  font-size: 12px;
}
:deep(.hcb--large .m-val) {
  width: 52px;
  font-size: 13px;
}

/* ---------- 列表 ---------- */
.host-list-wrap {
  background: var(--el-bg-color, #fff);
  border-radius: 4px;
  overflow: hidden;
}
.host-list-table {
  width: 100%;
  :deep(.el-table__header th) {
    font-weight: 600;
    background: var(--el-fill-color-lighter, #fafafa);
  }
  :deep(.host-list-row) {
    cursor: pointer;
  }
  :deep(.host-list-row.is-danger-row > td.el-table__cell) {
    background: var(--el-color-danger-light-9, #fef0f0) !important;
  }
  :deep(.host-list-row.is-danger-row .list-host-name) {
    color: var(--el-color-danger);
  }
  :deep(.el-table__row:hover > td.el-table__cell) {
    background: var(--el-color-primary-light-9, #ecf5ff) !important;
  }
  :deep(.host-list-row.is-danger-row:hover > td.el-table__cell) {
    background: var(--el-color-danger-light-8, #fde2e2) !important;
  }
  :deep(.el-table__cell) {
    padding: 10px 0;
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
.list-os-cell {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-variant-numeric: tabular-nums;
  font-size: 13px;
}
.list-err {
  font-size: 12px;
  color: var(--el-color-danger);
}
.load-cell {
  font-variant-numeric: tabular-nums;
  &.is-alert {
    color: var(--el-color-danger);
    font-weight: 600;
  }
}
.load-sep {
  margin: 0 2px;
  color: var(--el-text-color-placeholder);
}
.load-cores {
  color: var(--el-text-color-secondary);
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
    color: var(--el-color-danger) !important;
    font-weight: 700;
  }
}
:deep(.list-metric-sub) {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

html.dark .host-card,
html.dark .host-list-wrap {
  background: var(--panel-main-bg-color-9, #2e313d);
}
</style>

<style>
/* 看板壳：盖住整应用（非简单放大列表） */
body.group-dash-lock {
  overflow: hidden !important;
}

.group-dashboard {
  position: fixed;
  inset: 0;
  z-index: 30000;
  display: flex;
  flex-direction: column;
  background: #0f1419;
  color: #e8eef5;
  font-family: inherit;
}

.group-dashboard .dash-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 14px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: linear-gradient(180deg, #161d27 0%, #121820 100%);
}

.group-dashboard .dash-header-left,
.group-dashboard .dash-header-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.group-dashboard .dash-title {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #fff;
}

.group-dashboard .dash-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(64, 158, 255, 0.2);
  color: #79bbff;
}

.group-dashboard .dash-meta {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.55);
}

.group-dashboard .dash-hint {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
  margin-left: 4px;
}

.group-dashboard .dash-hint kbd {
  padding: 0 5px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.08);
  font-size: 11px;
  font-family: inherit;
}

.group-dashboard .dash-alert-tag {
  animation: dash-pulse 1.6s ease-in-out infinite;
}

@keyframes dash-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(245, 108, 108, 0.45);
  }
  50% {
    box-shadow: 0 0 0 6px rgba(245, 108, 108, 0);
  }
}

.group-dashboard .dash-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.group-dashboard .dash-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.group-dashboard .dash-zone {
  flex-shrink: 0;
}

.group-dashboard .zone-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 12px;
}

.group-dashboard .zone-title {
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.75);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.group-dashboard .zone-title.danger {
  color: #f89898;
}

.group-dashboard .zone-count {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
}

.group-dashboard .zone-empty {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.35);
  padding: 12px 0;
}

.group-dashboard .dash-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
}

.group-dashboard .dash-card {
  position: relative;
  padding: 16px;
  border-radius: 10px;
  background: #1a222d;
  border: 1px solid rgba(255, 255, 255, 0.08);
  cursor: default;
  user-select: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease,
    transform 0.15s ease;
}

.group-dashboard .dash-card:hover {
  border-color: rgba(64, 158, 255, 0.45);
  transform: translateY(-1px);
}

.group-dashboard .dash-card.is-alarm {
  background: linear-gradient(145deg, #2a1518 0%, #1f1214 100%);
  border-color: #f56c6c;
  box-shadow: 0 0 0 1px rgba(245, 108, 108, 0.35),
    0 8px 24px rgba(245, 108, 108, 0.12);
  animation: dash-card-alarm 2s ease-in-out infinite;
}

@keyframes dash-card-alarm {
  0%,
  100% {
    box-shadow: 0 0 0 1px rgba(245, 108, 108, 0.35),
      0 8px 24px rgba(245, 108, 108, 0.1);
  }
  50% {
    box-shadow: 0 0 0 2px rgba(245, 108, 108, 0.7),
      0 8px 28px rgba(245, 108, 108, 0.22);
  }
}

/* 看板内卡片文字提亮 */
.group-dashboard .hcb .host-name {
  color: #fff;
}
.group-dashboard .hcb .host-sub,
.group-dashboard .hcb .host-meta,
.group-dashboard .hcb .m-label,
.group-dashboard .hcb .m-sub {
  color: rgba(255, 255, 255, 0.55);
}
.group-dashboard .hcb .m-val {
  color: rgba(255, 255, 255, 0.92);
}
.group-dashboard .hcb .m-val.is-alert,
.group-dashboard .hcb .metric-row.is-alert .m-label {
  color: #f89898 !important;
}
.group-dashboard .hcb .avatar:not(.err) {
  background: rgba(64, 158, 255, 0.12);
}
.group-dashboard .hcb .err-text {
  color: #f89898;
}

.group-alert-notify {
  white-space: pre-line !important;
  max-width: 420px;
  border-left: 4px solid var(--el-color-danger) !important;
}
.group-alert-notify .el-notification__title {
  color: var(--el-color-danger);
  font-weight: 700;
}
.group-alert-notify .el-notification__content {
  white-space: pre-line;
  line-height: 1.55;
  font-size: 13px;
}
</style>
