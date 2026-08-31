<template>
  <div class="net-root" v-loading="loading && !snap">
    <div class="toolbar">
      <el-button size="large" :loading="loading" @click="refresh">刷新</el-button>
      <span class="hint">
        连接 {{ snap?.connTotal ?? 0 }} · 已建立
        {{ snap?.connEstablished ?? 0 }} · 监听
        {{ snap?.connListen ?? 0 }} · TIME_WAIT
        {{ snap?.connTimeWait ?? 0 }}
      </span>
      <el-tag
        v-if="(snap?.slowConnections || []).length"
        type="danger"
        effect="dark"
        size="small"
      >
        卡顿连接 {{ snap?.slowConnections?.length }}
      </el-tag>
    </div>

    <el-alert
      v-if="error && !snap"
      type="error"
      :title="error"
      show-icon
      class="mb"
    />

    <div v-if="snap" class="net-body">
      <!-- IP 总览：高对比卡片，纯 IPv4，可点复制（bare 包装，右上角可最大化） -->
      <EnlargableCard
        bare
        title="IP 总览"
        class="mb ip-grid"
        @toggle="onIpCardToggle"
      >
        <div
          class="ip-card panel-hover-card"
          :class="{ 'is-empty': !privateIPv4List.length }"
        >
          <div class="ip-card__head enl-head-zone">
            <span class="ip-card__dot ip-card__dot--private" />
            <span class="ip-card__title">内网 IP</span>
          </div>
          <div v-if="!privateIPv4List.length" class="ip-empty">未获取到</div>
          <button
            v-for="ip in visibleIps(privateIPv4List, 'private')"
            :key="'p' + ip"
            type="button"
            class="ip-value"
            :title="`点击复制 ${ip}`"
            @click="copyIp(ip)"
          >
            <span class="ip-value__text">{{ ip }}</span>
            <span class="ip-value__copy">复制</span>
          </button>
          <button
            v-if="privateIPv4List.length > IP_COLLAPSE_LIMIT"
            type="button"
            class="ip-toggle"
            @click="ipExpanded.private = !ipExpanded.private"
          >
            {{ ipExpanded.private ? "收起" : `展开剩余 ${privateIPv4List.length - IP_COLLAPSE_LIMIT} 个` }}
          </button>
        </div>

        <div
          class="ip-card panel-hover-card"
          :class="{
            'is-empty': !publicIPv4List.length && !snap.egressPublicIP,
          }"
        >
          <div class="ip-card__head enl-head-zone">
            <span class="ip-card__dot ip-card__dot--public" />
            <span class="ip-card__title">公网 / 外网 IP</span>
          </div>
          <div
            v-if="!publicIPv4List.length && !snap.egressPublicIP"
            class="ip-empty"
          >
            未获取到
          </div>
          <button
            v-if="snap.egressPublicIP"
            type="button"
            class="ip-value ip-value--accent"
            :title="
              snap.egressPublicLoc
                ? `点击复制 ${pureIp(snap.egressPublicIP)}（${snap.egressPublicLoc}）`
                : `点击复制 ${pureIp(snap.egressPublicIP)}`
            "
            @click="copyIp(snap.egressPublicIP)"
          >
            <span class="ip-value__text">
              <span class="ip-value__tag">出口</span>
              {{ pureIp(snap.egressPublicIP) }}
              <span v-if="snap.egressPublicLoc" class="ip-value__loc">
                {{ snap.egressPublicLoc }}
              </span>
            </span>
            <span class="ip-value__copy">复制</span>
          </button>
          <button
            v-for="ip in visibleIps(publicIPv4List, 'public')"
            :key="'u' + ip"
            type="button"
            class="ip-value"
            :title="`点击复制 ${ip}`"
            @click="copyIp(ip)"
          >
            <span class="ip-value__text">{{ ip }}</span>
            <span class="ip-value__copy">复制</span>
          </button>
          <button
            v-if="publicIPv4List.length > IP_COLLAPSE_LIMIT"
            type="button"
            class="ip-toggle"
            @click="ipExpanded.public = !ipExpanded.public"
          >
            {{ ipExpanded.public ? "收起" : `展开剩余 ${publicIPv4List.length - IP_COLLAPSE_LIMIT} 个` }}
          </button>
        </div>

        <div
          class="ip-card panel-hover-card"
          :class="{ 'is-empty': !dockerIPv4List.length }"
        >
          <div class="ip-card__head enl-head-zone">
            <span class="ip-card__dot ip-card__dot--docker" />
            <span class="ip-card__title">Docker 网桥 IP</span>
          </div>
          <div v-if="!dockerIPv4List.length" class="ip-empty">未检测到</div>
          <button
            v-for="ip in visibleIps(dockerIPv4List, 'docker')"
            :key="'d' + ip"
            type="button"
            class="ip-value"
            :title="`点击复制 ${ip}`"
            @click="copyIp(ip)"
          >
            <span class="ip-value__text">{{ ip }}</span>
            <span class="ip-value__copy">复制</span>
          </button>
          <button
            v-if="dockerIPv4List.length > IP_COLLAPSE_LIMIT"
            type="button"
            class="ip-toggle"
            @click="ipExpanded.docker = !ipExpanded.docker"
          >
            {{ ipExpanded.docker ? "收起" : `展开剩余 ${dockerIPv4List.length - IP_COLLAPSE_LIMIT} 个` }}
          </button>
        </div>

        <div
          class="ip-card panel-hover-card"
          :class="{ 'is-empty': !snap.defaultGateway }"
        >
          <div class="ip-card__head enl-head-zone">
            <span class="ip-card__dot ip-card__dot--gw" />
            <span class="ip-card__title">默认网关</span>
          </div>
          <div v-if="!snap.defaultGateway" class="ip-empty">未获取到</div>
          <button
            v-else
            type="button"
            class="ip-value"
            :title="`点击复制 ${pureIp(snap.defaultGateway)}`"
            @click="copyIp(pureIp(snap.defaultGateway))"
          >
            <span class="ip-value__text">{{ pureIp(snap.defaultGateway) }}</span>
            <span class="ip-value__copy">复制</span>
          </button>
        </div>
      </EnlargableCard>

      <!-- 网卡 -->
      <EnlargableCard
        bare
        title="网卡"
        class="ifaces-card"
        :class="{ 'is-max': ifacesEnlarged }"
        @toggle="(v) => (ifacesEnlarged = v)"
      >
      <el-card shadow="never" class="mb block-card panel-hover-card">
        <div class="block-title enl-head-zone">网卡</div>
        <div class="m3-table-surface">
        <el-table
          :data="snap.interfaces || []"
          size="default"
          stripe
          class="data-table-unified no-x-scroll-table"
          :height="ifacesEnlarged ? '100%' : 140"
        >
          <el-table-column prop="name" label="接口" min-width="88" />
          <el-table-column label="类型" width="88">
            <template #default="{ row }">
              <el-tag size="small" :type="kindTag(row.kind)">{{ kindLabel(row.kind) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="state" label="状态" width="96" show-overflow-tooltip />
          <el-table-column prop="mtu" label="MTU" width="64" />
          <el-table-column prop="mac" label="MAC" min-width="120" show-overflow-tooltip />
          <el-table-column label="IPv4" min-width="130">
            <template #default="{ row }">
              <!-- 多 IP（如 docker 网桥/子接口）逐行展示，自动撑开行高 -->
              <div class="iface-ips">
                <span v-for="ip in ifaceIpv4List(row.ipv4)" :key="ip">{{ ip }}</span>
                <span v-if="!ifaceIpv4List(row.ipv4).length">—</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="接收" width="88">
            <template #default="{ row }">{{ formatBytes(row.rxBytes || 0) }}</template>
          </el-table-column>
          <el-table-column label="发送" width="88">
            <template #default="{ row }">{{ formatBytes(row.txBytes || 0) }}</template>
          </el-table-column>
        </el-table>
        </div>
      </el-card>
      </EnlargableCard>

      <!-- 卡顿连接 -->
      <EnlargableCard
        v-if="(snap.slowConnections || []).length"
        bare
        title="卡顿连接"
        class="ifaces-card"
        :class="{ 'is-max': slowEnlarged }"
        @toggle="(v) => (slowEnlarged = v)"
      >
      <el-card
        shadow="never"
        class="mb block-card slow-card panel-hover-card"
      >
        <div class="block-title warn enl-head-zone">
          疑似网络卡顿连接
          <span class="sub">Send-Q/Recv-Q 积压 ≥ 8KB 或 RTT ≥ 200ms（已建立连接）</span>
        </div>
        <div class="m3-table-surface">
        <el-table
          :data="snap.slowConnections"
          size="default"
          stripe
          class="data-table-unified"
          :height="slowEnlarged ? '100%' : undefined"
          :max-height="slowEnlarged ? undefined : 200"
          row-class-name="slow-row"
        >
          <el-table-column prop="process" label="进程" width="120" show-overflow-tooltip />
          <el-table-column prop="pid" label="PID" width="80" />
          <el-table-column prop="localAddr" label="本地" min-width="140" show-overflow-tooltip />
          <el-table-column prop="remoteAddr" label="远端" min-width="140" show-overflow-tooltip />
          <el-table-column prop="recvQ" label="Recv-Q" width="90" />
          <el-table-column prop="sendQ" label="Send-Q" width="90" />
          <el-table-column label="RTT" width="80">
            <template #default="{ row }">
              {{ row.rttMs ? row.rttMs.toFixed(1) + "ms" : "—" }}
            </template>
          </el-table-column>
          <el-table-column prop="slowReason" label="原因" min-width="140" show-overflow-tooltip />
        </el-table>
        </div>
      </el-card>
      </EnlargableCard>

      <!-- 全部连接 -->
      <EnlargableCard bare title="TCP 连接" class="flex-fill">
      <el-card shadow="never" class="block-card panel-hover-card" style="height: 100%">
        <div class="block-head enl-head-zone">
          <div class="block-title">TCP 连接</div>
          <el-input
            v-model="filter"
            size="large"
            clearable
            class="filter"
            placeholder="过滤 进程/地址/状态..."
          />
          <el-checkbox v-model="onlyEstab" size="large">仅 ESTAB</el-checkbox>
          <el-checkbox v-model="onlySlow" size="large">仅卡顿</el-checkbox>
        </div>
        <div ref="connWrap" class="conn-table-wrap m3-table-surface m3-table-v2">
          <!-- 虚拟化表格：全量 TCP 连接可能数百条，只画可视区 -->
          <el-table-v2
            v-if="connSize.width.value > 0"
            :columns="connColumns"
            :data="filteredConns"
            :width="connSize.width.value"
            :height="connSize.height.value"
            :row-height="M3_TABLE_ROW_HEIGHT"
            :header-height="M3_TABLE_HEADER_HEIGHT"
            :row-class="connRowClass"
          />
        </div>
      </el-card>
      </EnlargableCard>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, h, reactive, ref } from "vue";

/** 网卡/卡顿连接卡片是否处于最大化（放大时表格高度改为自适应填满） */
const ifacesEnlarged = ref(false);
const slowEnlarged = ref(false);
import { ElMessage, ElTag } from "element-plus";
import type { Column } from "element-plus";
import { api } from "@/api";
import EnlargableCard from "@/components/EnlargableCard.vue";
import { usePolling } from "@/composables/usePolling";
import { useContainerSize } from "@/composables/useContainerSize";
import { copyText } from "@/utils/clipboard";
import { formatBytes } from "@/utils/format";
import {
  M3_TABLE_HEADER_HEIGHT,
  M3_TABLE_ROW_HEIGHT,
} from "@/constants/m3Table";

export interface NetInterface {
  name: string;
  state: string;
  mtu: number;
  mac: string;
  ipv4: string[];
  kind: string;
  rxBytes: number;
  txBytes: number;
}

export interface NetConnection {
  proto: string;
  state: string;
  localAddr: string;
  remoteAddr: string;
  recvQ: number;
  sendQ: number;
  pid: number;
  process: string;
  slow: boolean;
  slowReason?: string;
  rttMs?: number;
}

export interface NetworkSnapshot {
  interfaces: NetInterface[];
  privateIPs: string[];
  publicIPs: string[];
  dockerIPs: string[];
  egressPublicIP: string;
  egressPublicLoc?: string;
  defaultGateway: string;
  connections: NetConnection[];
  slowConnections: NetConnection[];
  connTotal: number;
  connEstablished: number;
  connListen: number;
  connTimeWait: number;
}

const props = defineProps<{ host: string }>();
const filter = ref("");
const onlyEstab = ref(false);
const onlySlow = ref(false);

const { data, error, loading, refresh } = usePolling<NetworkSnapshot>(
  () => api.collectNetwork(props.host) as Promise<NetworkSnapshot>,
  8000,
  () => [props.host]
);

const snap = computed(() => data.value);

/** 去掉 CIDR / 接口后缀，只保留 IPv4 */
function pureIp(raw: string): string {
  if (!raw) return "";
  // "192.168.10.57/24 (eth0)" 或 "192.168.10.57/24"
  const noParen = raw.split("(")[0].trim();
  return noParen.split("/")[0].trim();
}

function uniqIps(list: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list || []) {
    const ip = pureIp(raw);
    if (!ip || seen.has(ip)) continue;
    seen.add(ip);
    out.push(ip);
  }
  return out;
}

const privateIPv4List = computed(() => uniqIps(snap.value?.privateIPs));
const publicIPv4List = computed(() => uniqIps(snap.value?.publicIPs));
const dockerIPv4List = computed(() => uniqIps(snap.value?.dockerIPs));

// IP 卡片折叠：每张卡片默认最多展示 IP_COLLAPSE_LIMIT 个，超出点击展开
const IP_COLLAPSE_LIMIT = 3;
const ipExpanded = reactive<Record<string, boolean>>({
  private: false,
  public: false,
  docker: false,
});

// 折叠时只返回前 IP_COLLAPSE_LIMIT 个；已展开或未超阈值时返回全部
function visibleIps(list: string[], key: string): string[] {
  if (ipExpanded[key] || list.length <= IP_COLLAPSE_LIMIT) {
    return list;
  }
  return list.slice(0, IP_COLLAPSE_LIMIT);
}

// IP 总览卡最大化时自动展开剩余 IP，退出最大化自动收起
function onIpCardToggle(enlarged: boolean) {
  ipExpanded.private = enlarged;
  ipExpanded.public = enlarged;
  ipExpanded.docker = enlarged;
}

const filteredConns = computed(() => {
  let list = snap.value?.connections || [];
  if (onlySlow.value) list = list.filter((c) => c.slow);
  if (onlyEstab.value) {
    list = list.filter((c) =>
      String(c.state || "")
        .toUpperCase()
        .includes("ESTAB")
    );
  }
  const q = filter.value.trim().toLowerCase();
  if (q) {
    list = list.filter(
      (c) =>
        (c.process || "").toLowerCase().includes(q) ||
        (c.localAddr || "").toLowerCase().includes(q) ||
        (c.remoteAddr || "").toLowerCase().includes(q) ||
        (c.state || "").toLowerCase().includes(q) ||
        String(c.pid).includes(q)
    );
  }
  return list;
});

function formatIfaceIpv4(list: string[] | undefined): string {
  if (!list?.length) return "—";
  return list.map((x) => pureIp(x)).filter(Boolean).join(", ") || "—";
}

/** 网卡 IPv4 列：每个 IP 独立一行 */
function ifaceIpv4List(list: string[] | undefined): string[] {
  return (list || []).map((x) => pureIp(x)).filter(Boolean);
}

async function copyIp(raw: string) {
  const ip = pureIp(raw);
  if (!ip) {
    ElMessage.warning("无有效 IP");
    return;
  }
  try {
    await copyText(ip);
    ElMessage.success(`已复制 ${ip}`);
  } catch (e) {
    ElMessage.error(`复制失败: ${e}`);
  }
}

function kindLabel(k: string) {
  const m: Record<string, string> = {
    physical: "物理",
    docker: "Docker",
    virtual: "虚拟",
    loopback: "回环",
    other: "其他",
  };
  return m[k] || k || "—";
}

function kindTag(k: string): "warning" | "success" | "info" | undefined {
  if (k === "docker") return "warning";
  if (k === "physical") return "success";
  if (k === "loopback") return "info";
  return undefined;
}

// 虚拟化表格（el-table-v2）：容器尺寸 + 列定义
const connWrap = ref<HTMLDivElement | null>(null);
const connSize = useContainerSize(connWrap);

const connColumns: Column<any>[] = [
  { key: "state", dataKey: "state", title: "状态", width: 96 },
  { key: "process", dataKey: "process", title: "进程", width: 150, flexGrow: 1, flexShrink: 1 },
  { key: "pid", dataKey: "pid", title: "PID", width: 72 },
  { key: "localAddr", dataKey: "localAddr", title: "本地地址", width: 150, flexGrow: 1, flexShrink: 1 },
  { key: "remoteAddr", dataKey: "remoteAddr", title: "远端地址", width: 150, flexGrow: 1, flexShrink: 1 },
  { key: "recvQ", dataKey: "recvQ", title: "Recv-Q", width: 80, align: "right" as const },
  { key: "sendQ", dataKey: "sendQ", title: "Send-Q", width: 80, align: "right" as const },
  {
    key: "rtt",
    dataKey: "rttMs",
    title: "RTT",
    width: 72,
    cellRenderer: ({ cellData }: { cellData?: number }) =>
      h("span", {}, cellData ? cellData.toFixed(1) + "ms" : "—"),
  },
  {
    key: "slow",
    dataKey: "slow",
    title: "标记",
    width: 72,
    cellRenderer: ({ cellData }: { cellData: boolean }) =>
      cellData
        ? h(ElTag, { type: "danger", size: "small", effect: "dark" }, () => "卡顿")
        : h("span", {}, ""),
  },
];

/** el-table-v2 行类名（卡顿行标红，对应原 row-class-name） */
function connRowClass({ rowData }: { rowData: NetConnection }) {
  return rowData.slow ? "slow-row-v2" : "";
}
</script>

<style scoped lang="scss">
.net-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  gap: 8px;
  box-sizing: border-box;
  overflow: hidden; /* 页面本身不出现滚动条 */
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.mb {
  margin-bottom: 8px;
  flex-shrink: 0;
}
.net-body {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden; /* 禁止外层横/纵滚动，仅表格内部滚动 */
  gap: 0;
}
/* —— IP 汇总卡片：高对比、可点击复制 —— */
.ip-grid {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  min-width: 0;

  @media (max-width: 1100px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.ip-card {
  min-height: 84px;
  min-width: 0;
  padding: 12px 14px;
  background: var(--m3-surface-container-lowest);
  border: 1px solid var(--m3-outline-variant) !important;
  border-radius: var(--m3-shape-m);
  box-shadow: none;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 8px;

  &.is-empty {
    background: var(--m3-surface-container, #f2f1f4);
  }
}

html.dark .ip-card {
  background: var(--el-bg-color);
  box-shadow: none;
  &.is-empty {
    background: var(--el-fill-color-darker, #1f1f1f);
  }
}

.ip-card__head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.ip-card__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  &--private {
    background: var(--m3-primary, #6750a4);
  }
  &--public {
    background: var(--m3-tertiary, #7d5260);
  }
  &--docker {
    background: var(--m3-secondary, #625b71);
  }
  &--gw {
    background: var(--m3-outline, #79747e);
  }
}

.ip-card__title {
  font: var(--m3-label-medium);
  font-weight: 600;
  color: var(--m3-on-surface-variant, #49454f);
  letter-spacing: 0.02em;
}

.ip-value {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin: 0;
  padding: 8px 12px;
  border: none;
  border-radius: var(--m3-shape-xs, 4px);
  background: var(--m3-surface-container, #f2f1f4);
  color: var(--m3-on-surface, #1a1a1d);
  text-align: left;
  cursor: pointer;
  transition: background var(--m3-motion-state), color var(--m3-motion-state);

  &:hover {
    background: color-mix(in srgb, var(--m3-on-surface) 8%, transparent);
    .ip-value__copy {
      opacity: 1;
    }
  }

  &--accent {
    .ip-value__text {
      color: var(--el-color-primary);
      font-weight: 600;
    }
  }
}

.ip-value__text {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  font-weight: 600;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ip-value__tag {
  display: inline-block;
  margin-right: 6px;
  padding: 0 5px;
  border-radius: var(--m3-shape-xs);
  font-size: 10px;
  font-weight: 600;
  font-family: inherit;
  vertical-align: middle;
  color: var(--m3-on-primary);
  background: var(--m3-primary);
}

.ip-value__loc {
  display: inline;
  margin-left: 8px;
  font-size: 11px;
  font-weight: 400;
  font-family: inherit;
  color: var(--el-text-color-secondary);
  letter-spacing: 0;
}

.ip-value__copy {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 500;
  color: var(--el-color-primary);
  opacity: 0.55;
  transition: opacity var(--m3-motion-fade);
}

.ip-empty {
  padding: 6px 8px;
  font-size: 13px;
  color: var(--el-text-color-placeholder, #a8abb2);
  background: transparent;
}

.ip-toggle {
  margin-top: 2px;
  padding: 6px 12px;
  border: none;
  border-radius: var(--m3-shape-full);
  background: transparent;
  color: var(--m3-primary, #6750a4);
  font: var(--m3-label-medium);
  text-align: center;
  cursor: pointer;
  transition: background var(--m3-motion-state);

  &:hover {
    background: color-mix(in srgb, var(--m3-on-surface) 8%, transparent);
  }
}

.block-card {
  min-width: 0;
  :deep(.el-card__body) {
    padding: 10px 12px;
  }
}
.ifaces-card {
  flex-shrink: 0;
}
/* 最大化时：卡片撑满浮层，内部表格随之拉高 */
.ifaces-card.is-max :deep(.el-card) {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.ifaces-card.is-max :deep(.el-card__body) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.ifaces-card.is-max :deep(.el-table) {
  flex: 1;
}
.block-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
  &.warn {
    color: var(--el-color-danger);
  }
  .sub {
    margin-left: 8px;
    font-size: 11px;
    font-weight: 400;
    color: var(--el-text-color-secondary);
  }
}
.block-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  flex-shrink: 0;
  .block-title {
    margin-bottom: 0;
  }
  .filter {
    width: 200px;
  }
}
.flex-fill {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  :deep(.el-card__body) {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
}
.conn-table-wrap {
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
.no-x-scroll-table {
  width: 100%;
  :deep(.el-table__body-wrapper),
  :deep(.el-scrollbar__wrap) {
    overflow-x: hidden !important;
  }
}

/* 网卡 IPv4 多行展示 */
.iface-ips {
  display: flex;
  flex-direction: column;
  gap: 2px;
  line-height: 1.4;
  font-size: 12px;
}
:deep(.slow-row) {
  --el-table-tr-bg-color: color-mix(in srgb, var(--m3-error) 12%, var(--m3-surface-container-lowest));
  td {
    background: color-mix(in srgb, var(--m3-error) 12%, var(--m3-surface-container-lowest)) !important;
  }
}
:deep(.el-table-v2__row.slow-row-v2) {
  background: color-mix(in srgb, var(--m3-error) 12%, var(--m3-surface-container-lowest));
}
.slow-card {
  border-color: color-mix(in srgb, var(--m3-error) 45%, var(--m3-outline-variant));
  flex-shrink: 0;
  max-height: 160px;
  overflow: hidden;
  :deep(.el-card__body) {
    max-height: 140px;
    overflow: hidden;
  }
}
</style>
