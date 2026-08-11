<template>
  <div class="net-root" v-loading="loading && !snap">
    <div class="toolbar">
      <el-button size="small" :loading="loading" @click="refresh">刷新</el-button>
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
      <!-- IP 总览：高对比卡片，纯 IPv4，可点复制 -->
      <div class="mb ip-grid">
        <div
          class="ip-card panel-hover-card"
          :class="{ 'is-empty': !privateIPv4List.length }"
        >
          <div class="ip-card__head">
            <span class="ip-card__dot ip-card__dot--private" />
            <span class="ip-card__title">内网 IP</span>
          </div>
          <div v-if="!privateIPv4List.length" class="ip-empty">未获取到</div>
          <button
            v-for="ip in privateIPv4List"
            :key="'p' + ip"
            type="button"
            class="ip-value"
            :title="`点击复制 ${ip}`"
            @click="copyIp(ip)"
          >
            <span class="ip-value__text">{{ ip }}</span>
            <span class="ip-value__copy">复制</span>
          </button>
        </div>

        <div
          class="ip-card panel-hover-card"
          :class="{
            'is-empty': !publicIPv4List.length && !snap.egressPublicIP,
          }"
        >
          <div class="ip-card__head">
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
            v-for="ip in publicIPv4List"
            :key="'u' + ip"
            type="button"
            class="ip-value"
            :title="`点击复制 ${ip}`"
            @click="copyIp(ip)"
          >
            <span class="ip-value__text">{{ ip }}</span>
            <span class="ip-value__copy">复制</span>
          </button>
        </div>

        <div
          class="ip-card panel-hover-card"
          :class="{ 'is-empty': !dockerIPv4List.length }"
        >
          <div class="ip-card__head">
            <span class="ip-card__dot ip-card__dot--docker" />
            <span class="ip-card__title">Docker 网桥 IP</span>
          </div>
          <div v-if="!dockerIPv4List.length" class="ip-empty">未检测到</div>
          <button
            v-for="ip in dockerIPv4List"
            :key="'d' + ip"
            type="button"
            class="ip-value"
            :title="`点击复制 ${ip}`"
            @click="copyIp(ip)"
          >
            <span class="ip-value__text">{{ ip }}</span>
            <span class="ip-value__copy">复制</span>
          </button>
        </div>

        <div
          class="ip-card panel-hover-card"
          :class="{ 'is-empty': !snap.defaultGateway }"
        >
          <div class="ip-card__head">
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
      </div>

      <!-- 网卡 -->
      <el-card shadow="never" class="mb block-card ifaces-card panel-hover-card">
        <div class="block-title">网卡</div>
        <el-table
          :data="snap.interfaces || []"
          size="small"
          stripe
          class="no-x-scroll-table"
          height="140"
        >
          <el-table-column prop="name" label="接口" min-width="88" />
          <el-table-column label="类型" width="88">
            <template #default="{ row }">
              <el-tag size="small" :type="kindTag(row.kind)">{{ kindLabel(row.kind) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="state" label="状态" width="72" />
          <el-table-column prop="mtu" label="MTU" width="64" />
          <el-table-column prop="mac" label="MAC" min-width="120" show-overflow-tooltip />
          <el-table-column label="IPv4" min-width="120" show-overflow-tooltip>
            <template #default="{ row }">
              {{ formatIfaceIpv4(row.ipv4) }}
            </template>
          </el-table-column>
          <el-table-column label="接收" width="88">
            <template #default="{ row }">{{ formatBytes(row.rxBytes || 0) }}</template>
          </el-table-column>
          <el-table-column label="发送" width="88">
            <template #default="{ row }">{{ formatBytes(row.txBytes || 0) }}</template>
          </el-table-column>
        </el-table>
      </el-card>

      <!-- 卡顿连接 -->
      <el-card
        v-if="(snap.slowConnections || []).length"
        shadow="never"
        class="mb block-card slow-card panel-hover-card"
      >
        <div class="block-title warn">
          疑似网络卡顿连接
          <span class="sub">Send-Q/Recv-Q 积压 ≥ 8KB 或 RTT ≥ 200ms（已建立连接）</span>
        </div>
        <el-table
          :data="snap.slowConnections"
          size="small"
          stripe
          max-height="200"
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
      </el-card>

      <!-- 全部连接 -->
      <el-card shadow="never" class="block-card flex-fill panel-hover-card">
        <div class="block-head">
          <div class="block-title">TCP 连接</div>
          <el-input
            v-model="filter"
            size="small"
            clearable
            class="filter"
            placeholder="过滤 进程/地址/状态..."
          />
          <el-checkbox v-model="onlyEstab" size="small">仅 ESTAB</el-checkbox>
          <el-checkbox v-model="onlySlow" size="small">仅卡顿</el-checkbox>
        </div>
        <div class="conn-table-wrap">
          <el-table
            :data="filteredConns"
            size="small"
            stripe
            height="100%"
            class="no-x-scroll-table"
            :row-class-name="rowClass"
          >
            <el-table-column prop="state" label="状态" width="96" />
            <el-table-column prop="process" label="进程" min-width="100" show-overflow-tooltip />
            <el-table-column prop="pid" label="PID" width="72" />
            <el-table-column prop="localAddr" label="本地地址" min-width="130" show-overflow-tooltip />
            <el-table-column prop="remoteAddr" label="远端地址" min-width="130" show-overflow-tooltip />
            <el-table-column prop="recvQ" label="Recv-Q" width="80" />
            <el-table-column prop="sendQ" label="Send-Q" width="80" />
            <el-table-column label="RTT" width="72">
              <template #default="{ row }">
                {{ row.rttMs ? row.rttMs.toFixed(1) + "ms" : "—" }}
              </template>
            </el-table-column>
            <el-table-column label="标记" width="72">
              <template #default="{ row }">
                <el-tag v-if="row.slow" type="danger" size="small" effect="dark">卡顿</el-tag>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import { api } from "@/api";
import { usePolling } from "@/composables/usePolling";
import { copyText } from "@/utils/clipboard";
import { formatBytes } from "@/utils/format";

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

function kindTag(k: string) {
  if (k === "docker") return "warning";
  if (k === "physical") return "success";
  if (k === "loopback") return "info";
  return "";
}

function rowClass({ row }: { row: NetConnection }) {
  return row.slow ? "slow-row" : "";
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
  padding: 10px 12px 12px;
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
  background: var(--el-bg-color, #fff);
  border: 1px solid var(--el-border-color, #dcdfe6) !important;
  border-radius: 6px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 8px;

  &.is-empty {
    background: var(--el-fill-color-blank, #fafafa);
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
    background: #67c23a;
  }
  &--public {
    background: #409eff;
  }
  &--docker {
    background: #e6a23c;
  }
  &--gw {
    background: #909399;
  }
}

.ip-card__title {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-regular, #606266);
  letter-spacing: 0.02em;
}

.ip-value {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin: 0;
  padding: 6px 8px;
  border: none;
  border-radius: 4px;
  background: var(--el-fill-color-light, #f5f7fa);
  color: var(--el-text-color-primary, #303133);
  text-align: left;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;

  &:hover {
    background: var(--el-color-primary-light-9, #ecf5ff);
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
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  font-family: inherit;
  vertical-align: middle;
  color: #fff;
  background: var(--el-color-primary);
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
  transition: opacity 0.12s;
}

.ip-empty {
  padding: 6px 8px;
  font-size: 13px;
  color: var(--el-text-color-placeholder, #a8abb2);
  background: transparent;
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
:deep(.slow-row) {
  --el-table-tr-bg-color: rgba(245, 108, 108, 0.12);
  td {
    background: rgba(245, 108, 108, 0.12) !important;
  }
}
.slow-card {
  border-color: rgba(245, 108, 108, 0.45);
  flex-shrink: 0;
  max-height: 160px;
  overflow: hidden;
  :deep(.el-card__body) {
    max-height: 140px;
    overflow: hidden;
  }
}
</style>
