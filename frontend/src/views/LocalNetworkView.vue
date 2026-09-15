<template>
  <div class="local-network">
    <PageSkeleton v-if="loading && !snap" variant="network" />
    <el-alert
      v-else-if="error && !snap"
      type="error"
      :title="error"
      show-icon
      :closable="false"
    />

    <template v-else-if="snap">
      <!-- 当前出口：先看清走哪张卡、IP、网关 -->
      <div class="egress-card">
        <div class="egress-row">
          <div class="egress-main">
            <div class="egress-ip mono">{{ snap.primaryIP || "—" }}</div>
            <div class="egress-facts">
              <div class="fact">
                <span class="fact-k">出口网卡</span>
                <span class="fact-v">{{ primaryIfaceText }}</span>
              </div>
              <div class="fact">
                <span class="fact-k">网关</span>
                <span class="fact-v mono">{{ snap.defaultGateway || "无" }}</span>
              </div>
              <div class="fact">
                <span class="fact-k">已连接</span>
                <span class="fact-v">{{ upCount }} 张</span>
              </div>
            </div>
          </div>
          <el-button :icon="Refresh" :loading="loading" @click="refresh" />
        </div>
      </div>

      <div class="filter-bar">
        <el-switch
          v-model="showAll"
          inline-prompt
          active-text="全部"
          inactive-text="已连"
        />
        <span class="filter-hint muted">
          <template v-if="showAll">显示全部网卡</template>
          <template v-else-if="downCount > 0">已隐藏 {{ downCount }} 张未连接</template>
          <template v-else>当前全部已连接</template>
        </span>
      </div>

      <div v-for="group in visibleGroups" :key="group.kind" class="iface-group">
        <div class="group-title">
          {{ group.label }}
          <span class="group-count muted">{{ group.items.length }}</span>
        </div>
        <div class="iface-table" role="table">
          <div class="iface-thead" role="row">
            <span class="col-seq">序</span>
            <span class="col-name">名称</span>
            <span class="col-state">状态</span>
            <span class="col-ip">IPv4</span>
            <span class="col-mac">MAC</span>
            <span class="col-traffic">收 / 发</span>
          </div>
          <div
            v-for="(ifc, idx) in group.items"
            :key="ifc.name"
            class="iface-row"
            role="row"
            :class="{
              'is-down': ifc.state !== 'up',
              'is-egress': isEgress(ifc),
              'is-dim': isVpnDim(ifc),
            }"
          >
            <span class="col-seq">{{ idx + 1 }}</span>
            <span class="col-name">
              <span class="iface-name">{{ displayName(ifc) }}</span>
              <el-tag
                v-if="isEgress(ifc)"
                size="small"
                type="primary"
                effect="plain"
                class="egress-tag"
              >
                出口
              </el-tag>
              <span class="iface-dev mono muted">{{ ifc.name }}</span>
            </span>
            <span class="col-state">
              <span class="iface-state" :class="ifc.state === 'up' ? 'up' : 'down'">
                {{ ifc.state === "up" ? "已连接" : "未连接" }}
              </span>
            </span>
            <span class="col-ip mono" v-tip="ifc.ipv4 || undefined">
              {{ ifc.ipv4 || "—" }}
            </span>
            <span class="col-mac mono" v-tip="ifc.mac || undefined">
              {{ ifc.mac || "—" }}
            </span>
            <span class="col-traffic mono">
              {{ formatBytes(ifc.rxBytes || 0) }} / {{ formatBytes(ifc.txBytes || 0) }}
            </span>
          </div>
        </div>
      </div>

      <el-empty
        v-if="!visibleGroups.length"
        :description="showAll ? '未发现网卡' : '没有已连接的网卡'"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { Refresh } from "@element-plus/icons-vue";
import { api } from "@/api";
import type { localsys } from "@/api";
import PageSkeleton from "@/components/PageSkeleton.vue";
import { usePolling } from "@/composables/usePolling";
import { useAppStore } from "@/stores/app";
import { formatBytes } from "@/utils/format";

const app = useAppStore();
/** 默认只看已连接，打开后显示全部（含未连接） */
const showAll = ref(false);

const { data: snap, error, loading, refresh } = usePolling<localsys.NetworkSnapshot>(
  () => api.localSysNetwork(),
  8000,
  () => "local-network",
  () =>
    app.workspace === "local" &&
    app.localSection === "network" &&
    !app.settingsOpen
);

const KIND_ORDER = ["wifi", "ethernet", "thunderbolt", "vpn", "other"] as const;
const KIND_LABEL: Record<string, string> = {
  wifi: "无线网",
  ethernet: "有线网",
  thunderbolt: "雷雳 / 网桥",
  vpn: "VPN",
  other: "其它",
};

function displayName(ifc: localsys.NetInterface): string {
  const display = (ifc.display || "").trim();
  if (display && display !== ifc.name) return display;
  return ifc.name;
}

function isEgress(ifc: localsys.NetInterface): boolean {
  const primary = snap.value?.primaryIface || "";
  return !!primary && ifc.name === primary;
}

/** VPN 虚接口：无 IPv4 且非出口 → 弱化 */
function isVpnDim(ifc: localsys.NetInterface): boolean {
  if ((ifc.kind || "") !== "vpn") return false;
  if (isEgress(ifc)) return false;
  return !(ifc.ipv4 || "").trim();
}

function sortIfaces(items: localsys.NetInterface[]): localsys.NetInterface[] {
  return [...items].sort((a, b) => {
    // 出口最前
    const ae = isEgress(a) ? 0 : 1;
    const be = isEgress(b) ? 0 : 1;
    if (ae !== be) return ae - be;
    // 已连接优先
    const au = a.state === "up" ? 0 : 1;
    const bu = b.state === "up" ? 0 : 1;
    if (au !== bu) return au - bu;
    // VPN 无 IP 靠后
    const ad = isVpnDim(a) ? 1 : 0;
    const bd = isVpnDim(b) ? 1 : 0;
    if (ad !== bd) return ad - bd;
    // 有 IPv4 的靠前
    const ai = (a.ipv4 || "").trim() ? 0 : 1;
    const bi = (b.ipv4 || "").trim() ? 0 : 1;
    if (ai !== bi) return ai - bi;
    return a.name.localeCompare(b.name);
  });
}

const primaryIfaceText = computed(() => {
  const name = snap.value?.primaryIface || "";
  if (!name) return "—";
  const hit = (snap.value?.interfaces || []).find((ifc) => ifc.name === name);
  if (!hit) return name;
  const label = displayName(hit);
  if (label === name) return name;
  return `${label}（${name}）`;
});

const upCount = computed(
  () => (snap.value?.interfaces || []).filter((ifc) => ifc.state === "up").length
);

const downCount = computed(
  () => (snap.value?.interfaces || []).filter((ifc) => ifc.state !== "up").length
);

const visibleGroups = computed(() => {
  const list = (snap.value?.interfaces || []).filter((ifc) => {
    if (showAll.value) return true;
    return ifc.state === "up";
  });
  const map = new Map<string, localsys.NetInterface[]>();
  for (const ifc of list) {
    const kind = ifc.kind || "other";
    if (!map.has(kind)) map.set(kind, []);
    map.get(kind)!.push(ifc);
  }
  const out: { kind: string; label: string; items: localsys.NetInterface[] }[] = [];
  for (const kind of KIND_ORDER) {
    const items = map.get(kind);
    if (items?.length) {
      out.push({
        kind,
        label: KIND_LABEL[kind] || kind,
        items: sortIfaces(items),
      });
    }
  }
  for (const [kind, items] of map) {
    if (!(KIND_ORDER as readonly string[]).includes(kind) && items.length) {
      out.push({
        kind,
        label: KIND_LABEL[kind] || kind,
        items: sortIfaces(items),
      });
    }
  }
  return out;
});
</script>

<style scoped lang="scss">
.local-network {
  min-height: 0;
}

.egress-card {
  margin-bottom: 10px;
  padding: 12px 16px;
  border-radius: var(--m3-shape-m, 12px);
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
}

.egress-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.egress-main {
  min-width: 0;
  flex: 1;
}

.egress-ip {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.25;
  color: var(--el-text-color-primary);
}

.egress-facts {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
}

.fact {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 13px;
  min-width: 0;
}

.fact-k {
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
}

.fact-v {
  color: var(--el-text-color-primary);
  word-break: break-all;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  min-height: 28px;
}

.filter-hint {
  font-size: 12px;
}

.iface-group {
  margin-bottom: 16px;
}

.group-title {
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 6px;
  color: var(--el-text-color-primary);
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.group-count {
  font-weight: 500;
  font-size: 12px;
}

.iface-table {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--m3-shape-m, 12px);
  background: var(--el-bg-color);
  overflow: hidden;
}

.iface-thead,
.iface-row {
  display: grid;
  grid-template-columns:
    64px
    minmax(140px, 1.4fr)
    72px
    minmax(110px, 1fr)
    minmax(120px, 1fr)
    minmax(120px, 1fr);
  gap: 8px 12px;
  align-items: center;
  padding: 8px 12px;
  font-size: 12px;
}

.col-seq {
  text-align: center;
  color: var(--el-text-color-secondary);
  font-variant-numeric: tabular-nums;
}

.iface-thead {
  background: var(--el-fill-color-lighter);
  color: var(--el-text-color-secondary);
  font-weight: 600;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.iface-row {
  border-bottom: 1px solid var(--el-border-color-extra-light, var(--el-border-color-lighter));
  &:last-child {
    border-bottom: none;
  }

  &.is-egress {
    background: color-mix(in srgb, var(--el-color-primary) 6%, transparent);
  }

  &.is-down {
    opacity: 0.7;
  }

  &.is-dim {
    opacity: 0.55;
  }
}

.col-name {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
}

.iface-name {
  font-weight: 600;
  font-size: 13px;
  color: var(--el-text-color-primary);
}

.egress-tag {
  flex-shrink: 0;
}

.iface-dev {
  width: 100%;
  font-size: 11px;
  line-height: 1.2;
}

.col-state {
  flex-shrink: 0;
}

.iface-state {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 8px;
  border-radius: 999px;
  white-space: nowrap;
  &.up {
    color: var(--el-color-success);
    background: color-mix(in srgb, var(--el-color-success) 14%, transparent);
  }
  &.down {
    color: var(--el-text-color-secondary);
    background: color-mix(in srgb, var(--el-text-color-secondary) 12%, transparent);
  }
}

.col-ip,
.col-mac,
.col-traffic {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.mono {
  font-family: var(--m3-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-variant-numeric: tabular-nums;
}

.muted {
  color: var(--el-text-color-secondary);
}

@media (max-width: 900px) {
  .iface-thead {
    display: none;
  }

  .iface-row {
    grid-template-columns: 1fr 1fr;
    grid-template-areas:
      "name state"
      "ip ip"
      "mac traffic";
  }

  .col-name {
    grid-area: name;
  }
  .col-state {
    grid-area: state;
    justify-self: end;
  }
  .col-ip {
    grid-area: ip;
  }
  .col-mac {
    grid-area: mac;
  }
  .col-traffic {
    grid-area: traffic;
    text-align: right;
  }
}
</style>
