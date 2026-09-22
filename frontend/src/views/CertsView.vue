<template>
  <div class="tab-root tab-table-page">
    <EnlargableCard bare class="tab-enl">
    <ViewToolbar>
      <span class="toolbar-meta">/etc/nginx/cert · {{ groups.length }} 张</span>
      <template #tools>
        <el-button type="primary" :icon="Plus" @click="openUpload">上传证书</el-button>
        <el-button :icon="Refresh" :loading="loading" @click="loadCerts">刷新</el-button>
      </template>
    </ViewToolbar>
    <PageSkeleton v-if="loading && !loaded" variant="table" :show-toolbar="false" />
    <template v-else-if="error && !loaded">
      <el-alert
        type="error"
        :title="error"
        show-icon
        :closable="false"
      />
    </template>
    <template v-else-if="loaded">
    <el-alert
      v-if="error"
      type="error"
      :title="error"
      show-icon
      :closable="false"
    />
    <el-alert
      v-else-if="result?.noOpenssl"
      type="warning"
      title="远程主机缺少 openssl，无法解析证书内容"
      show-icon
      :closable="false"
    />
    <div v-if="groups.length" class="table-wrap m3-table-surface">
    <el-table
      :data="groups"
      height="100%"
      size="default"
      class="data-table-unified"
    >
      <el-table-column type="index" label="序" width="64" align="center" />
      <el-table-column label="证书文件" min-width="200">
        <template #default="{ row }">
          <div class="cert-name-group">
            <span class="cert-name mono" v-for="n in row.names" :key="n">{{ n }}</span>
            <el-tag v-if="row.selfSigned" size="small" type="info">自签名</el-tag>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="域名" min-width="220" show-overflow-tooltip>
        <template #default="{ row }">
          <span class="mono">{{ (row.domains ?? []).join(", ") || "—" }}</span>
        </template>
      </el-table-column>
      <el-table-column label="颁发者" min-width="140" show-overflow-tooltip>
        <template #default="{ row }">
          <span>{{ row.issuer || "—" }}</span>
        </template>
      </el-table-column>
      <el-table-column label="有效期至" min-width="200">
        <template #default="{ row }">
          <span class="mono">{{ formatTime(row.notAfter) }}</span>
          <span class="days-left" :class="daysClass(row)">
            （{{ daysText(row) }}）
          </span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag size="small" :type="statusType(row)">
            {{ statusText(row) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="私钥" width="160" show-overflow-tooltip>
        <template #default="{ row }">
          <span v-if="row.hasKey" class="mono">{{ row.keyName }}</span>
          <el-tag v-else size="small" type="danger">缺失</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="80" fixed="right">
        <template #default="{ row }">
          <el-button size="small" type="danger" link @click="removeGroup(row)">
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    </div>
    <el-empty
      v-if="!loading && !error && result && !result.installed"
      description="当前主机没有安装证书"
    >
      <template #image>
        <el-icon :size="60" class="empty-icon"><FolderRemove /></el-icon>
      </template>
      <div class="empty-sub">未找到 /etc/nginx/cert 目录，上传证书到该目录后即可在此管理</div>
    </el-empty>
    <el-empty
      v-else-if="!loading && !error && result && result.installed && !result.noOpenssl && groups.length === 0"
      description="/etc/nginx/cert 目录为空"
    />
    </template>
    </EnlargableCard>

    <!-- 上传证书：拖入证书+私钥 → 本地配对校验 → 通过才可上传 -->
    <el-dialog
      v-model="uploadVisible"
      title="上传证书"
      width="560px"
      @close="closeUpload"
    >
      <div
        class="dropzone"
        data-file-drop-target
        :class="{ hover: dropHover, checking: pairChecking }"
        @dragenter="onDragEnter"
        @dragleave="onDragLeave"
        @dragover.prevent
        @drop.prevent="onDropFallback"
      >
        <el-icon :size="36"><UploadFilled /></el-icon>
        <div class="drop-title">拖入证书 + 私钥文件</div>
        <div class="drop-sub">自动识别证书 / 私钥，本地校验配对通过后才能上传</div>
      </div>

      <el-alert
        v-if="pairError"
        type="error"
        :title="pairError"
        show-icon
        :closable="false"
        class="pair-result"
      />
      <div v-if="pairChecking" class="pair-result" v-loading="true" element-loading-text="校验中…" style="min-height: 60px" />
      <div v-if="pair && !pairChecking" class="pair-result ok">
        <div class="pair-row">
          <span class="pair-label">证书</span>
          <span class="mono">{{ fileName(pair.certPath) }}</span>
        </div>
        <div class="pair-row">
          <span class="pair-label">私钥</span>
          <span class="mono">{{ fileName(pair.keyPath) }}</span>
        </div>
        <div class="pair-row">
          <span class="pair-label">域名</span>
          <span class="mono">{{ (pair.domains ?? []).join(", ") || "—" }}</span>
        </div>
        <div class="pair-row">
          <span class="pair-label">有效期至</span>
          <span class="mono">{{ formatTime(pair.notAfter) }}（剩余 {{ pair.daysLeft }} 天）</span>
        </div>
        <el-alert type="success" title="配对成功" :closable="false" show-icon />
      </div>

      <template #footer>
        <el-button @click="uploadVisible = false">取消</el-button>
        <el-button
          type="primary"
          :disabled="!pair || !!pairError"
          :loading="uploading"
          @click="doUpload"
        >
          上传
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { FolderRemove, Plus, Refresh, UploadFilled } from "@element-plus/icons-vue";
import { registerFileDrop } from "@/utils/fileDrop";
import { ElMessage, ElMessageBox } from "element-plus";
import { api } from "@/api";
import type { CertInfo, CertListResult, CertPairCheck } from "@/api";
import { formatErr } from "@/utils/format";
import { useAppStore } from "@/stores/app";
import EnlargableCard from "@/components/EnlargableCard.vue";
import PageSkeleton from "@/components/PageSkeleton.vue";
import ViewToolbar from "@/components/ViewToolbar.vue";
import { certGroupKey } from "@/utils/certGroup";

const props = defineProps<{ host: string }>();

const CERT_DIR = "/etc/nginx/cert";

const result = ref<CertListResult | null>(null);
const loading = ref(false);
const loaded = ref(false);
const error = ref<string | null>(null);

const list = ref<CertInfo[]>([]);

/** 同一张证书的多个格式文件（如 .crt + .pem）合并成一组 */
interface CertGroup {
  names: string[];
  domains: string[];
  issuer: string;
  notAfter: number;
  daysLeft: number;
  selfSigned: boolean;
  hasKey: boolean;
  keyName: string;
}

const groups = computed<CertGroup[]>(() => {
  const map = new Map<string, CertGroup>();
  for (const c of list.value) {
    const key = certGroupKey(c.domains, c.issuer, c.notAfter);
    const g = map.get(key);
    if (g) {
      g.names.push(c.name);
      if (c.hasKey) {
        g.hasKey = true;
        g.keyName = c.keyName;
      }
    } else {
      map.set(key, {
        names: [c.name],
        domains: c.domains ?? [],
        issuer: c.issuer,
        notAfter: c.notAfter,
        daysLeft: c.daysLeft,
        selfSigned: c.selfSigned,
        hasKey: c.hasKey,
        keyName: c.keyName,
      });
    }
  }
  return [...map.values()].sort((a, b) => a.names[0].localeCompare(b.names[0]));
});

async function loadCerts() {
  loading.value = true;
  error.value = null;
  try {
    result.value = await api.collectCerts(props.host);
    list.value = result.value?.certs || [];
  } catch (e) {
    error.value = formatErr(e);
  } finally {
    loading.value = false;
    loaded.value = true;
  }
}

function formatTime(unix: number): string {
  if (!unix) return "—";
  const d = new Date(unix * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 即将过期阈值（天），与 1Panel 保持一致 */
const EXPIRE_SOON = 30;

function statusText(row: CertGroup | Record<string, unknown>): string {
  const g = row as CertGroup;
  if (g.daysLeft < 0) return "已过期";
  if (g.daysLeft <= EXPIRE_SOON) return "即将过期";
  return "有效";
}

function statusType(row: CertGroup | Record<string, unknown>): "success" | "warning" | "danger" {
  const g = row as CertGroup;
  if (g.daysLeft < 0) return "danger";
  if (g.daysLeft <= EXPIRE_SOON) return "warning";
  return "success";
}

function daysText(row: CertGroup | Record<string, unknown>): string {
  const g = row as CertGroup;
  if (g.daysLeft < 0) return `已过期 ${-g.daysLeft} 天`;
  return `剩余 ${g.daysLeft} 天`;
}

function daysClass(row: CertGroup | Record<string, unknown>): string {
  const g = row as CertGroup;
  if (g.daysLeft < 0) return "danger";
  if (g.daysLeft <= EXPIRE_SOON) return "warning";
  return "ok";
}

async function removeGroup(row: CertGroup | Record<string, unknown>) {
  const g = row as CertGroup;
  const paths = g.names.map((n) => `${CERT_DIR}/${n}`);
  if (g.hasKey) paths.push(`${CERT_DIR}/${g.keyName}`);
  const tip = g.hasKey ? `及其私钥 ${g.keyName}` : "";
  try {
    await ElMessageBox.confirm(
      `将删除证书 ${g.names.join("、")}${tip}，删除后不可恢复，确定继续吗？`,
      "删除证书",
      { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" }
    );
  } catch {
    return;
  }
  try {
    await api.deletePaths(props.host, paths);
    ElMessage.success(`已删除 ${g.names.join("、")}`);
    loadCerts();
  } catch (e) {
    ElMessage.error(`删除失败: ${e}`);
  }
}

// ---- 上传证书：拖入 → 本地配对校验 → 上传 ----
const uploadVisible = ref(false);
const dropHover = ref(false);
let dragCounter = 0;
const pair = ref<CertPairCheck | null>(null);
const pairError = ref<string | null>(null);
const pairChecking = ref(false);
const uploading = ref(false);

let offDrop: (() => void) | null = null;

function openUpload() {
  pair.value = null;
  pairError.value = null;
  uploadVisible.value = true;
  // 上传弹窗打开期间接收全页拖放（LIFO 栈顶）
  offDrop?.();
  offDrop = registerFileDrop(handleUploadDrop);
}

function closeUpload() {
  offDrop?.();
  offDrop = null;
}

function onDragEnter() {
  dragCounter++;
  dropHover.value = true;
}

function onDragLeave() {
  dragCounter--;
  if (dragCounter <= 0) {
    dropHover.value = false;
    dragCounter = 0;
  }
}

// webview drop 兜底复位高亮；实际路径由 Wails OnFileDrop 回调提供
function onDropFallback() {
  dropHover.value = false;
  dragCounter = 0;
}

function handleUploadDrop(paths: string[]) {
  dropHover.value = false;
  dragCounter = 0;
  if (!paths?.length) return;
  void checkPair(paths);
}

async function checkPair(paths: string[]) {
  pair.value = null;
  pairError.value = null;
  pairChecking.value = true;
  try {
    pair.value = await api.checkCertPair(paths);
  } catch (e) {
    pairError.value = formatErr(e);
  } finally {
    pairChecking.value = false;
  }
}

function fileName(p: string): string {
  return p.split("/").pop() || p;
}

async function doUpload() {
  if (!pair.value) return;
  uploading.value = true;
  try {
    await api.uploadCertPair(props.host, pair.value.certPath, pair.value.keyPath);
    ElMessage.success("证书上传成功");
    uploadVisible.value = false;
    loadCerts();
  } catch (e) {
    ElMessage.error(`上传失败: ${formatErr(e)}`);
  } finally {
    uploading.value = false;
  }
}

onUnmounted(() => {
  // 弹窗未关但组件被卸载时兜底注销拖放监听
  offDrop?.();
  offDrop = null;
});

watch(() => props.host, () => loadCerts(), { immediate: true });

// 子页常驻后切回时补刷一次（证书有效期随时间变化）
const app = useAppStore();
watch(
  () => app.isHostSubActive(props.host, "certs"),
  (now, prev) => {
    if (now && !prev) void loadCerts();
  }
);
</script>

<style scoped>
.tab-root {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.cert-name-group {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}
.cert-name {
  font-weight: 500;
}
.mono {
  font-family: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
  font-size: 12px;
}
.days-left.ok {
  color: var(--el-color-success);
}
.days-left.warning {
  color: var(--el-color-warning);
}
.days-left.danger {
  color: var(--el-color-danger);
}
.empty-icon {
  color: var(--el-text-color-disabled);
}
.empty-sub {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: -16px;
}
.dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 28px 16px;
  border: 1px dashed var(--el-border-color);
  border-radius: var(--m3-shape-s);
  color: var(--el-text-color-secondary);
  transition: border-color var(--m3-motion-select);
}
.dropzone.hover,
.dropzone.file-drop-target-active {
  border-color: var(--m3-primary);
  color: var(--m3-primary);
  background: color-mix(in srgb, var(--m3-primary) 8%, var(--m3-surface-container-lowest));
}
.drop-title {
  font-size: 14px;
  color: var(--el-text-color-regular);
}
.drop-sub {
  font-size: 12px;
}
.pair-result {
  margin-top: 14px;
}
.pair-result.ok .pair-row {
  display: flex;
  gap: 10px;
  padding: 4px 0;
  font-size: 13px;
}
.pair-label {
  width: 56px;
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
}
.pair-result.ok .el-alert {
  margin-top: 8px;
}
</style>
