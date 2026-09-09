<template>
  <div class="all-hosts">
    <!-- 顶栏 -->
    <div class="summary-bar">
      <div class="summary-left">
        <span class="meta">共 {{ app.hosts.length }} 台</span>
        <el-tag
          v-if="app.runningHosts.length"
          size="small"
          type="success"
          effect="dark"
        >
          运行中 {{ app.runningHosts.length }}
        </el-tag>
      </div>
      <div class="summary-right">
        <el-button
          link
          type="primary"
          :icon="Refresh"
          :loading="app.loading"
          :title="isMac ? '刷新 (⌘R)' : '刷新 (Ctrl+R)'"
          @click="app.refresh()"
        >
          刷新
        </el-button>
        <el-button
          link
          type="primary"
          :icon="Picture"
          :loading="app.iconsRefreshing"
          @click="onRefreshIcons"
        >
          检查图标
        </el-button>
      </div>
    </div>

    <el-empty
      v-if="app.hosts.length === 0"
      description="暂无主机，右键侧栏空白处可添加主机或新建分组"
    />

    <!-- 菜单检查（独立模块，与主机分组并列） -->
    <section class="group-section menu-check-section">
      <div class="group-head">
        <span class="group-color-dot" style="background-color: #0f766e" />
        <span class="group-name" style="color: #0f766e">菜单检查</span>
        <span
          class="group-count"
          style="color: #0f766e; background-color: rgba(15, 118, 110, 0.12)"
        >
          {{ menuChecks.length }}
        </span>
      </div>
      <div class="host-grid">
        <div
          v-for="item in menuChecks"
          :key="item.id"
          class="host-card menu-check-card"
          :class="{ 'is-checking': item.checking }"
          @click="onMenuCheck(item)"
        >
          <div class="host-info">
            <div class="host-name">{{ item.label }}</div>
            <div class="host-sub">
              {{ item.checking ? "检查中…" : "点击检查" }}
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 按分组分段 -->
    <div v-if="app.hosts.length > 0" class="group-sections">
      <section
        v-for="(node, idx) in groups"
        :key="node.key"
        class="group-section"
      >
        <div class="group-head">
          <span
            class="group-color-dot"
            :style="{ backgroundColor: colorOf(node, idx).accent }"
          />
          <span
            class="group-name"
            :style="{ color: colorOf(node, idx).ink }"
          >
            {{ node.title }}
          </span>
          <span
            class="group-count"
            :style="{
              color: colorOf(node, idx).ink,
              backgroundColor: colorOf(node, idx).soft,
            }"
          >
            {{ node.hosts.length }}
          </span>
        </div>

        <div v-if="node.hosts.length === 0" class="group-empty">
          该分组暂无主机
        </div>
        <div v-else class="host-grid">
          <div
            v-for="h in node.hosts"
            :key="h.name"
            class="host-card"
            :class="{ 'is-running': app.isRunning(h.name) }"
            @click="openHost(h.name)"
          >
            <span
              class="host-ico-wrap"
              :title="
                app.osReleaseMap.get(h.name)
                  ? `${app.osReleaseMap.get(h.name)}（右键重新识别）`
                  : '未识别发行版，右键探测'
              "
              @click.stop
              @contextmenu.prevent="onRefreshOneIcon(h.name)"
            >
              <DistroLogo
                :os-release="app.osReleaseMap.get(h.name) || ''"
                :size="22"
                class="host-ico"
              />
            </span>
            <div class="host-info">
              <div class="host-name">
                {{ h.name }}
                <span
                  v-if="app.isRunning(h.name)"
                  class="run-dot"
                  title="运行中（后台保持）"
                />
              </div>
              <div class="host-sub">
                {{ h.user || "?" }}@{{ h.hostName || "?" }}
              </div>
              <div v-if="h.note" class="host-note" :title="h.note">
                {{ h.note }}
              </div>
              <div v-if="showPort(h.port)" class="host-port">
                端口 {{ h.port }}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive } from "vue";
import { Picture, Refresh } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Events } from "@wailsio/runtime";
import DistroLogo from "@/components/DistroLogo.vue";
import { api } from "@/api";
import { useAppStore, UNGROUPED_ID } from "@/stores/app";
import { copyText } from "@/utils/clipboard";
import { formatErr } from "@/utils/format";
import type { sshconfig } from "@/api";
import type { main } from "@/api";

const app = useAppStore();
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

type MenuCheckStatus = "" | "ok" | "bad";

interface MenuCheckItem {
  id: string;
  label: string;
  url: string;
  checking: boolean;
  status: MenuCheckStatus;
  menuOk: boolean | null;
  dataOk: boolean | null;
  menuText: string;
  dataText: string;
  message: string;
}

/** 由后端 ListMenuChecks 填充；占位避免首屏空白 */
const menuChecks = reactive<MenuCheckItem[]>([
  {
    id: "data-report",
    label: "数据上报",
    url: "",
    checking: false,
    status: "",
    menuOk: null,
    dataOk: null,
    menuText: "",
    dataText: "",
    message: "",
  },
]);

let offMenuCheck: (() => void) | null = null;

function applyMenuResult(r: main.MenuCheckResult) {
  if (!r?.id) return;
  let item = menuChecks.find((x) => x.id === r.id);
  if (!item) {
    item = {
      id: r.id,
      label: r.label || r.id,
      url: r.url || "",
      checking: false,
      status: "",
      menuOk: null,
      dataOk: null,
      menuText: "",
      dataText: "",
      message: "",
    };
    menuChecks.push(item);
  }
  item.label = r.label || item.label;
  item.url = r.url || item.url;
  if (r.checkedAt <= 0 && !r.message && !r.menuText) return;
  item.menuOk = !!r.ok;
  item.dataOk = !!r.hasData;
  item.menuText = r.menuText || (r.ok ? "菜单正常" : "菜单异常");
  item.dataText = r.dataText || (r.hasData ? "数据正常" : "数据异常");
  item.message = r.message || `${item.menuText}\n${item.dataText}`;
  if (r.ok && r.hasData) {
    item.status = "ok";
  } else {
    item.status = "bad";
  }
}

async function loadMenuChecks() {
  try {
    const list = await api.listMenuChecks();
    for (const r of list) applyMenuResult(r);
  } catch {
    /* 启动瞬间后端未就绪时忽略 */
  }
}

/**
 * 分组色板：与 SidebarHost 保持一致，概览页分组色与侧栏呼应。
 * accent=色条/圆点，soft=浅底，ink=文字/图标
 */
const GROUP_PALETTE = [
  { accent: "#005eeb", soft: "rgba(0, 94, 235, 0.12)", ink: "#005eeb" },
  { accent: "#196eed", soft: "rgba(25, 110, 237, 0.12)", ink: "#196eed" },
  { accent: "#337eef", soft: "rgba(51, 126, 239, 0.12)", ink: "#337eef" },
  { accent: "#4c8ef1", soft: "rgba(76, 142, 241, 0.12)", ink: "#4c8ef1" },
  { accent: "#669ef3", soft: "rgba(102, 158, 243, 0.12)", ink: "#669ef3" },
  { accent: "#505f79", soft: "rgba(80, 95, 121, 0.12)", ink: "#505f79" },
  { accent: "#0077cc", soft: "rgba(0, 119, 204, 0.12)", ink: "#0077cc" },
  { accent: "#0066b3", soft: "rgba(0, 102, 179, 0.12)", ink: "#0066b3" },
  { accent: "#004494", soft: "rgba(0, 68, 148, 0.12)", ink: "#004494" },
  { accent: "#7faef5", soft: "rgba(127, 174, 245, 0.12)", ink: "#669ef3" },
] as const;

const UNGROUPED_COLOR = {
  accent: "#909399",
  soft: "rgba(144, 147, 153, 0.12)",
  ink: "#646a73",
} as const;

type GroupColor = {
  accent: string;
  soft: string;
  ink: string;
};

interface GroupSection {
  key: string;
  title: string;
  hosts: sshconfig.HostConfig[];
  ungrouped: boolean;
}

/** 分组结构 + 主机基本信息（含端口）来自 store，本地即时数据 */
const groups = computed<GroupSection[]>(() =>
  app.groupNodes.map((n) => ({
    key: n.group?.id || UNGROUPED_ID,
    title: n.group?.name || "未分组",
    hosts: n.hosts,
    ungrouped: !n.group,
  }))
);

function colorOf(node: GroupSection, index: number): GroupColor {
  if (node.ungrouped) return UNGROUPED_COLOR;
  return GROUP_PALETTE[index % GROUP_PALETTE.length];
}

/** 默认 22 端口不展示，减少视觉噪音 */
function showPort(port?: string): boolean {
  return !!port && port !== "22";
}

function openHost(name: string) {
  app.openHostTab(name);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function menuCheckResultHtml(
  menuOk: boolean,
  menuText: string,
  dataOk: boolean,
  dataText: string,
  url: string
): string {
  const row = (ok: boolean, text: string) => {
    const mark = ok ? "✓" : "❌";
    const color = ok ? "#16a34a" : "#dc2626";
    return (
      `<div style="display:flex;align-items:flex-start;gap:10px;margin:12px 0;line-height:1.55;font-size:16px;color:${color}">` +
      `<span style="flex-shrink:0;font-weight:700;font-size:18px;line-height:1.4">${mark}</span>` +
      `<span style="min-width:0;word-break:break-word">${escapeHtml(text)}</span>` +
      `</div>`
    );
  };
  let html = row(menuOk, menuText) + row(dataOk, dataText);
  if (url) {
    html +=
      `<div style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(127,127,127,0.25)">` +
      `<div style="font-size:13px;color:#64748b;margin-bottom:8px">检查地址</div>` +
      `<div title="${escapeHtml(url)}" style="font-size:14px;line-height:1.45;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;user-select:all;color:var(--el-text-color-regular,#303133)">${escapeHtml(url)}</div>` +
      `</div>`;
  }
  return html;
}

async function onCopyMenuUrl(url: string) {
  const u = url.trim();
  if (!u) {
    ElMessage.warning("暂无检查地址");
    return;
  }
  try {
    await copyText(u);
    ElMessage.success("已复制完整地址");
  } catch {
    ElMessage.error("复制失败");
  }
}

async function showMenuCheckResult(
  label: string,
  menuOk: boolean,
  menuText: string,
  dataOk: boolean,
  dataText: string,
  url: string
) {
  try {
    await ElMessageBox.alert(
      menuCheckResultHtml(menuOk, menuText, dataOk, dataText, url),
      `菜单检查 · ${label}`,
      {
        customClass: "menu-check-msgbox",
        confirmButtonText: "知道了",
        cancelButtonText: "复制地址",
        showCancelButton: !!url,
        distinguishCancelAndClose: true,
        dangerouslyUseHTMLString: true,
        showClose: true,
      }
    );
  } catch (action) {
    if (action === "cancel" && url) {
      await onCopyMenuUrl(url);
    }
  }
}

async function onMenuCheck(item: MenuCheckItem) {
  if (item.checking) return;
  item.checking = true;
  item.menuText = "";
  item.dataText = "";
  item.message = "正在检查…";
  try {
    // 仅 Go HTTP 拉取；结果只展示在页面/弹窗，不发企微与桌面通知
    const r = await api.checkMenuPage(item.id);
    applyMenuResult(r);
    const menuText = r.menuText || (r.ok ? "菜单正常" : "菜单异常");
    const dataText = r.dataText || (r.hasData ? "数据正常" : "数据异常");
    const url = r.url || item.url;
    await showMenuCheckResult(
      item.label,
      !!r.ok,
      menuText,
      !!r.hasData,
      dataText,
      url
    );
  } catch (e) {
    item.status = "bad";
    item.menuOk = false;
    item.dataOk = false;
    item.menuText = "菜单异常：" + formatErr(e);
    item.dataText = "数据异常：菜单不可用，无法判断";
    item.message = `${item.menuText}\n${item.dataText}`;
    await showMenuCheckResult(
      item.label,
      false,
      item.menuText,
      false,
      item.dataText,
      item.url
    );
  } finally {
    item.checking = false;
  }
}

onMounted(() => {
  void loadMenuChecks();
  offMenuCheck = Events.On(
    "menu-check-updated",
    (ev: { data?: main.MenuCheckResult }) => {
      if (ev?.data) applyMenuResult(ev.data);
    }
  );
});

onBeforeUnmount(() => {
  offMenuCheck?.();
  offMenuCheck = null;
});

async function onRefreshOneIcon(name: string) {
  try {
    const os = await app.refreshHostIcon(name);
    ElMessage.success(`${name}：${os || "图标已更新"}`);
  } catch (e) {
    ElMessage.error(`更新图标失败: ${formatErr(e)}`);
  }
}

async function onRefreshIcons() {
  try {
    const r = await app.refreshAllHostIcons();
    if (r.failed.length > 0) {
      ElMessage.warning(
        `已更新 ${r.ok} 台，失败 ${r.failed.length} 台`
      );
    } else {
      ElMessage.success(`已检查并更新 ${r.ok} 台主机图标`);
    }
  } catch (e) {
    ElMessage.error(`检查图标失败: ${formatErr(e)}`);
  }
}
</script>

<style scoped lang="scss">
.all-hosts {
  min-height: 200px;
}
.summary-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
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

/* ---------- 分组分段 ---------- */
.group-sections {
  display: flex;
  flex-direction: column;
  gap: 22px;
}
.menu-check-section {
  margin-bottom: 22px;
}
.menu-check-card.is-checking {
  opacity: 0.75;
  cursor: wait;
}
.group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.group-color-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
}
.group-name {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.group-count {
  font-size: 11px;
  font-weight: 600;
  min-width: 18px;
  height: 18px;
  line-height: 18px;
  text-align: center;
  padding: 0 6px;
  border-radius: 9px;
}
.group-empty {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  padding: 4px 0 8px;
}

/* ---------- 主机卡片网格 ---------- */
.host-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}
.host-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: var(--m3-surface-container-lowest, #fff);
  border: none;
  border-radius: var(--m3-shape-m, 12px);
  box-sizing: border-box;
  cursor: pointer;
  outline: none;
  box-shadow: inset 0 0 0 1px var(--m3-outline-variant, #cac4d0);
  transition: box-shadow var(--m3-motion-select);

  &:hover {
    box-shadow: inset 0 0 0 2px var(--m3-primary);
  }
}
.host-ico-wrap {
  display: flex;
  flex-shrink: 0;
  cursor: context-menu;
}
.host-ico {
  flex-shrink: 0;
}
.host-info {
  min-width: 0;
  flex: 1;
}
.host-name {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 6px;
}
.host-sub {
  margin-top: 2px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.host-note {
  margin-top: 2px;
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.host-port {
  margin-top: 2px;
  font-size: 11px;
  color: var(--el-text-color-placeholder);
}
.run-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--m3-primary, #6750a4);
  flex-shrink: 0;
}

html.dark .host-card {
  background: var(--m3-surface-container-low, #1a1a1d);
}
</style>

<style lang="scss">
/* MessageBox 挂到 body，需非 scoped */
.menu-check-msgbox {
  width: 800px !important;
  max-width: min(800px, 96vw) !important;
  min-height: 360px;
  padding-bottom: 8px;
  /* 暗色底上弹窗边框必须可见，不能靠极弱阴影辨认边缘 */
  border: 1px solid var(--m3-outline-variant, rgba(255, 255, 255, 0.16)) !important;
  border-radius: var(--m3-shape-l, 16px) !important;
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.06),
    0 12px 40px rgba(0, 0, 0, 0.55) !important;
  background: var(--m3-surface-container-high, #252d3d) !important;
}
html:not(.dark) .menu-check-msgbox {
  border-color: var(--m3-outline, #c9cdd4) !important;
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.04),
    0 12px 32px rgba(0, 0, 0, 0.14) !important;
  background: var(--m3-surface-container-lowest, #fff) !important;
}
.menu-check-msgbox .el-message-box__header {
  padding: 24px 48px 10px 28px;
}
.menu-check-msgbox .el-message-box__title {
  font-size: 19px;
  line-height: 1.4;
  font-weight: 600;
}
.menu-check-msgbox .el-message-box__content {
  padding: 20px 28px 24px;
  min-height: 200px;
}
.menu-check-msgbox .el-message-box__message {
  max-width: 100%;
  overflow: hidden;
}
.menu-check-msgbox .el-message-box__btns {
  padding: 14px 28px 24px;
}
.menu-check-msgbox .el-message-box__btns .el-button {
  min-width: 104px;
  height: 38px;
}
</style>
