<template>
  <div class="sysinfo-page">
    <PageSkeleton v-if="loading && !report" variant="sysinfo" />
    <el-alert
      v-else-if="error && !report"
      type="error"
      :title="error"
      show-icon
      :closable="false"
      class="sysinfo-alert"
    />

    <div v-else-if="report" class="sysinfo-layout">
      <aside class="sysinfo-nav">
        <div class="sysinfo-nav-head">
          <span class="panel-section-title">分类</span>
          <el-button
            link
            type="primary"
            :loading="loading"
            @click="refresh(true)"
          >
            刷新
          </el-button>
        </div>
        <button
          v-for="sec in report.sections"
          :key="sec.id"
          type="button"
          class="sysinfo-nav-item"
          :class="{ 'is-active': sec.id === activeId }"
          @click="activeId = sec.id"
        >
          {{ sec.title }}
        </button>
        <div v-if="report.collectedAt" class="sysinfo-nav-foot muted">
          采集于 {{ formatCollectedAt(report.collectedAt) }}
        </div>
      </aside>

      <main class="sysinfo-main">
        <div class="sysinfo-main-head">
          <h2 class="sysinfo-title">{{ activeSection?.title || "—" }}</h2>
          <div class="sysinfo-actions">
            <el-button
              link
              type="primary"
              :disabled="!activeSection"
              @click="copySection"
            >
              复制本页
            </el-button>
          </div>
        </div>

        <template v-if="activeSection">
          <div
            v-for="(item, idx) in activeSection.items"
            :key="idx"
            class="sysinfo-block"
          >
            <div v-if="showItemTitle(activeSection, item)" class="sysinfo-block-title">
              {{ item.name }}
            </div>
            <div v-if="item.rows?.length" class="kv-list">
              <div v-for="(row, ri) in item.rows" :key="ri" class="kv-row">
                <span class="kv-label">{{ row.label }}</span>
                <span class="kv-value" :title="row.value">{{ row.value || "—" }}</span>
              </div>
            </div>
            <div
              v-for="(child, ci) in item.children || []"
              :key="'c' + ci"
              class="sysinfo-child"
            >
              <div class="sysinfo-child-title">{{ child.name }}</div>
              <div v-if="child.rows?.length" class="kv-list">
                <div v-for="(row, ri) in child.rows" :key="ri" class="kv-row">
                  <span class="kv-label">{{ row.label }}</span>
                  <span class="kv-value" :title="row.value">{{ row.value || "—" }}</span>
                </div>
              </div>
              <div
                v-for="(grand, gi) in child.children || []"
                :key="'g' + gi"
                class="sysinfo-grandchild"
              >
                <div class="sysinfo-child-title">{{ grand.name }}</div>
                <div v-if="grand.rows?.length" class="kv-list">
                  <div v-for="(row, ri) in grand.rows" :key="ri" class="kv-row">
                    <span class="kv-label">{{ row.label }}</span>
                    <span class="kv-value" :title="row.value">{{ row.value || "—" }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
        <el-empty v-else description="无数据" />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { api } from "@/api";
import type { localsys } from "@/api";
import PageSkeleton from "@/components/PageSkeleton.vue";
import { copyText } from "@/utils/clipboard";

const report = ref<localsys.SystemReport | null>(null);
const error = ref<string | null>(null);
const loading = ref(false);
const activeId = ref("summary");

const activeSection = computed(() => {
  const list = report.value?.sections || [];
  return list.find((s) => s.id === activeId.value) || list[0] || null;
});

watch(
  () => report.value?.sections,
  (secs) => {
    if (!secs?.length) return;
    if (!secs.some((s) => s.id === activeId.value)) {
      activeId.value = secs[0].id;
    }
  }
);

function showItemTitle(
  sec: localsys.ReportSection,
  item: localsys.ReportItem
): boolean {
  if (sec.items.length > 1) return true;
  if ((item.children || []).length > 0) return true;
  const n = (item.name || "").trim();
  return (
    n !== "" &&
    n !== "详情" &&
    n !== "本机摘要" &&
    n !== "hardware_overview" &&
    n !== "os_overview"
  );
}

function formatCollectedAt(sec: number): string {
  if (!sec) return "—";
  return new Date(sec * 1000).toLocaleString("zh-CN", {
    hour12: false,
  });
}

function formatRows(rows: localsys.ReportRow[] | null | undefined, indent = ""): string {
  if (!rows?.length) return "";
  return rows.map((r) => `${indent}${r.label}\t${r.value || "—"}`).join("\n");
}

function formatItem(item: localsys.ReportItem, depth = 0): string {
  const pad = "  ".repeat(depth);
  const lines: string[] = [];
  const name = (item.name || "").trim();
  if (name && name !== "详情") {
    lines.push(`${pad}${name}`);
  }
  const rows = formatRows(item.rows, pad + (name && name !== "详情" ? "  " : ""));
  if (rows) lines.push(rows);
  for (const ch of item.children || []) {
    const block = formatItem(ch, depth + (name && name !== "详情" ? 1 : 0));
    if (block) lines.push(block);
  }
  return lines.filter(Boolean).join("\n");
}

function formatSection(sec: localsys.ReportSection): string {
  const parts = [`【${sec.title}】`];
  for (const it of sec.items || []) {
    const block = formatItem(it);
    if (block) parts.push(block);
  }
  return parts.join("\n");
}

async function copySection() {
  const sec = activeSection.value;
  if (!sec) return;
  try {
    await copyText(formatSection(sec) + "\n");
    ElMessage.success(`已复制「${sec.title}」`);
  } catch {
    ElMessage.error("复制失败");
  }
}

async function refresh(force = false) {
  loading.value = true;
  try {
    report.value = await api.localSysSystemReport(force);
    error.value = null;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void refresh(false);
});
</script>

<style scoped lang="scss">
.sysinfo-page {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.sysinfo-alert {
  margin-bottom: 10px;
}

.sysinfo-layout {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  gap: 12px;
  align-items: stretch;
}

.sysinfo-nav {
  min-height: 0;
  overflow: auto;
  padding: 10px 8px;
  border-radius: var(--m3-shape-m, 12px);
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sysinfo-nav-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 8px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--m3-outline-variant, var(--el-border-color-lighter));
}

.sysinfo-nav-item {
  appearance: none;
  border: 0;
  background: transparent;
  text-align: left;
  padding: 8px 10px;
  border-radius: 8px;
  font: var(--m3-body-medium);
  color: var(--el-text-color-regular);
  cursor: pointer;
  line-height: 1.3;

  &:hover {
    background: var(--el-fill-color-light);
  }

  &.is-active {
    background: var(--el-color-primary-light-9, var(--el-fill-color));
    color: var(--el-color-primary);
    font-weight: 600;
  }
}

.sysinfo-nav-foot {
  margin-top: auto;
  padding: 10px 8px 2px;
  font-size: 11px;
  line-height: 1.35;
}

.sysinfo-main {
  min-height: 0;
  overflow: auto;
  padding: 12px 16px 16px;
  border-radius: var(--m3-shape-m, 12px);
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
}

.sysinfo-main-head {
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.sysinfo-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.sysinfo-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--el-text-color-primary);
}

.sysinfo-block {
  margin-bottom: 16px;
  &:last-child {
    margin-bottom: 0;
  }
}

.sysinfo-block-title,
.sysinfo-child-title {
  font: var(--m3-title-small);
  font-weight: 600;
  color: var(--m3-primary, var(--el-color-primary));
  margin-bottom: 6px;
}

.sysinfo-child {
  margin-top: 12px;
  padding-left: 8px;
  border-left: 2px solid var(--m3-outline-variant, var(--el-border-color-lighter));
}

.sysinfo-grandchild {
  margin-top: 8px;
  padding-left: 8px;
}

.kv-list {
  display: flex;
  flex-direction: column;
}

.kv-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-height: 30px;
  padding: 4px 0;
  border-bottom: 1px solid var(--m3-outline-variant);
  &:last-of-type {
    border-bottom: none;
  }
}

.kv-label {
  flex-shrink: 0;
  width: 10em;
  font: var(--m3-body-medium);
  color: var(--m3-on-surface-variant);
}

.kv-value {
  flex: 1;
  min-width: 0;
  word-break: break-word;
  font: var(--m3-body-medium);
  color: var(--m3-on-surface);
  font-variant-numeric: tabular-nums;
}

.muted {
  color: var(--el-text-color-secondary);
}

@media (max-width: 900px) {
  .sysinfo-layout {
    grid-template-columns: 1fr;
  }

  .sysinfo-nav {
    max-height: 220px;
  }
}
</style>
