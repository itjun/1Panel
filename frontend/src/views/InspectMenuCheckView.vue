<template>
  <div class="menu-check-page">
    <div class="page-toolbar">
      <span class="page-toolbar__meta">
        {{ summaryText }}
      </span>
      <div class="page-toolbar__spacer" />
      <el-button
        type="primary"
        plain
        :loading="checkingAll"
        @click="onCheckAll"
      >
        全部检查
      </el-button>
    </div>

    <el-empty
      v-if="menuChecks.length === 0"
      description="暂无巡检项（后端未返回任何菜单检查配置）"
    />

    <div v-else class="check-grid">
      <div
        v-for="item in menuChecks"
        :key="item.id"
        class="check-card"
        :class="{ 'is-checking': item.checking }"
        @click="onMenuCheck(item)"
      >
        <div class="check-card__head">
          <span
            class="menu-check-dot"
            :class="{
              'is-ok': item.status === 'ok',
              'is-bad': item.status === 'bad',
              'is-spin': item.checking,
            }"
          />
          <span class="check-card__label">{{ item.label }}</span>
          <el-tag
            v-if="item.checking"
            size="small"
            type="info"
            effect="plain"
          >
            检查中…
          </el-tag>
          <el-tag
            v-else-if="item.status === 'ok'"
            size="small"
            type="success"
            effect="plain"
          >
            正常
          </el-tag>
          <el-tag
            v-else-if="item.status === 'bad'"
            size="small"
            type="danger"
            effect="plain"
          >
            异常
          </el-tag>
          <el-tag v-else size="small" type="info" effect="plain">
            未检查
          </el-tag>
        </div>

        <div class="check-card__rows">
          <div class="check-card__row">
            <span class="check-card__row-label">菜单</span>
            <span
              class="check-card__row-value"
              :class="rowTone(item.menuOk)"
            >
              {{ item.menuText || "—" }}
            </span>
          </div>
          <div class="check-card__row">
            <span class="check-card__row-label">数据</span>
            <span
              class="check-card__row-value"
              :class="rowTone(item.dataOk)"
            >
              {{ item.dataText || "—" }}
            </span>
          </div>
          <div v-if="lastCheckedText(item)" class="check-card__row">
            <span class="check-card__row-label">时间</span>
            <span class="check-card__row-value is-muted">
              {{ lastCheckedText(item) }}
            </span>
          </div>
        </div>

        <div class="check-card__foot">
          <span class="check-card__hint">
            {{ item.checking ? "检查中…" : "点击检查" }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 巡检 · 菜单检查：展示内置检查项，点击发起 Go HTTP 探活。
 * 结果只展示在页面/弹窗，不发企微与桌面通知（告警通知由后台定时任务负责）。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Events } from "@wailsio/runtime";
import { api } from "@/api";
import { copyText } from "@/utils/clipboard";
import { formatErr } from "@/utils/format";
import type { main } from "@/api";

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
  checkedAt: number;
}

/** 由后端 ListMenuChecks 填充；启动即拉取，不等手动点击 */
const menuChecks = reactive<MenuCheckItem[]>([]);
const checkingAll = ref(false);

const summaryText = computed(() => {
  const total = menuChecks.length;
  if (total === 0) return "共 0 项";
  const ok = menuChecks.filter((i) => i.status === "ok").length;
  const bad = menuChecks.filter((i) => i.status === "bad").length;
  const parts = [`共 ${total} 项`];
  if (ok > 0) parts.push(`正常 ${ok}`);
  if (bad > 0) parts.push(`异常 ${bad}`);
  return parts.join(" · ");
});

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
      checkedAt: 0,
    };
    menuChecks.push(item);
  }
  item.label = r.label || item.label;
  item.url = r.url || item.url;
  if (r.checkedAt > 0) item.checkedAt = r.checkedAt;
  // 快照里没有检查结果（如首次挂载只回元数据）时，不覆盖既有状态
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
    const color = ok ? "#1e8e3e" : "#f56c6c";
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
      `<div data-tip="${escapeHtml(url)}" style="font-size:14px;line-height:1.45;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;user-select:all;color:var(--el-text-color-regular,#303133)">${escapeHtml(url)}</div>` +
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

async function onCheckAll() {
  if (checkingAll.value) return;
  checkingAll.value = true;
  try {
    for (const item of menuChecks) {
      if (item.checking) continue;
      // 逐项检查但不逐项弹窗：结果直接落在卡片上
      item.checking = true;
      item.menuText = "";
      item.dataText = "";
      item.message = "正在检查…";
      try {
        const r = await api.checkMenuPage(item.id);
        applyMenuResult(r);
      } catch (e) {
        item.status = "bad";
        item.menuOk = false;
        item.dataOk = false;
        item.menuText = "菜单异常：" + formatErr(e);
        item.dataText = "数据异常：菜单不可用，无法判断";
        item.message = `${item.menuText}\n${item.dataText}`;
      } finally {
        item.checking = false;
      }
    }
  } finally {
    checkingAll.value = false;
  }
}

function rowTone(ok: boolean | null): string {
  if (ok === true) return "is-ok";
  if (ok === false) return "is-bad";
  return "is-muted";
}

function lastCheckedText(item: MenuCheckItem): string {
  if (!item.checkedAt) return "";
  const d = new Date(item.checkedAt);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
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
</script>

<style scoped lang="scss">
.menu-check-page {
  min-height: 200px;
}

.page-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.page-toolbar__meta {
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
}

.page-toolbar__spacer {
  flex: 1;
}

.check-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}

.check-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border-radius: 12px;
  background: var(--m3-surface-container-lowest, #fff);
  box-shadow: inset 0 0 0 1px var(--m3-outline-variant);
  cursor: pointer;
  transition: box-shadow var(--m3-motion-state),
    background-color var(--m3-motion-state);

  &:hover:not(.is-checking) {
    background: color-mix(
      in srgb,
      var(--m3-primary) 4%,
      var(--m3-surface-container-lowest, #fff)
    );
    box-shadow: inset 0 0 0 1px
      color-mix(in srgb, var(--m3-primary) 35%, transparent);
  }

  &.is-checking {
    cursor: wait;
    opacity: 0.8;
  }
}

.check-card__head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.check-card__label {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  font-weight: 650;
  color: var(--m3-on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.menu-check-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--el-text-color-placeholder, #a8abb2);

  &.is-ok {
    background: var(--m3-status-online);
  }

  &.is-bad {
    background: var(--m3-error);
  }

  &.is-spin {
    animation: menu-check-pulse 1s ease-in-out infinite;
  }
}

@keyframes menu-check-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

.check-card__rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.check-card__row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.check-card__row-label {
  flex-shrink: 0;
  width: 32px;
  font-size: 12px;
  color: var(--m3-on-surface-variant);
}

.check-card__row-value {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  &.is-ok {
    color: var(--m3-status-online);
  }

  &.is-bad {
    color: var(--m3-error);
  }

  &.is-muted {
    color: var(--m3-on-surface-variant);
  }
}

.check-card__foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.check-card__hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>

<style lang="scss">
/* MessageBox 挂到 body，需非 scoped（自全部主机页迁来，样式保持一致） */
.menu-check-msgbox {
  width: 800px !important;
  max-width: min(800px, 96vw) !important;
  min-height: 360px;
  padding-bottom: 8px;
  border: 1px solid var(--m3-outline) !important;
  border-radius: var(--m3-shape-l) !important;
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.04),
    0 12px 32px rgba(0, 0, 0, 0.14) !important;
  background: var(--m3-surface-container-lowest) !important;
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
