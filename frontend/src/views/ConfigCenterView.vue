<template>
  <div class="config-center" v-loading="loading">
    <div class="config-center__toolbar">
      <div class="config-center__tabs" role="tablist" aria-label="配置中心导航">
        <button
          v-for="item in sections"
          :key="item.id"
          type="button"
          class="config-center__tab"
          :class="{ 'is-active': section === item.id }"
          @click="openSection(item.id)"
        >
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
          <span v-if="item.id === 'diff' && conflictCount" class="config-center__tab-count">
            {{ conflictCount }}
          </span>
        </button>
      </div>
      <div class="config-center__actions">
        <el-tag :type="statusType" effect="plain" round>{{ statusLabel }}</el-tag>
        <el-button text :icon="Refresh" :loading="loading" @click="refreshAll">刷新</el-button>
        <el-button
          v-if="overview?.drift || overview?.needsReview"
          text
          type="warning"
          :icon="Upload"
          :loading="busy"
          @click="previewExternalImport"
        >
          导入差异
        </el-button>
      </div>
    </div>

    <el-alert
      v-if="errorMessage"
      class="config-center__error"
      type="error"
      :closable="false"
      show-icon
      :title="errorMessage"
    />

    <div class="config-center__content">
      <section v-if="section === 'overview'" class="config-overview">
        <div class="config-overview__hero panel-surface">
          <div>
            <div class="eyebrow">CONFIG CONTROL CENTER</div>
            <h2>让 Panel JSON 和 SSH 产物各司其职</h2>
            <p>
              主机页维护连接模型，配置中心负责校验、生成、回滚和对外工具兼容。
              密码留在 Panel JSON，永远不会写进 OpenSSH 配置。
            </p>
          </div>
          <div class="config-overview__hero-actions">
            <el-button type="primary" :icon="EditPen" @click="openSection('json')">
              编辑 Panel JSON
            </el-button>
            <el-button :icon="Document" @click="openSection('files')">查看 SSH 文件</el-button>
          </div>
        </div>

        <div class="config-stat-grid">
          <div class="config-stat panel-surface">
            <span class="config-stat__label">Panel 主机</span>
            <strong>{{ overview?.hostCount ?? 0 }}</strong>
            <small>Revision {{ overview?.revision ?? 0 }}</small>
          </div>
          <div class="config-stat panel-surface">
            <span class="config-stat__label">分组</span>
            <strong>{{ overview?.groupCount ?? 0 }}</strong>
            <small>结构化编辑仍在主机页</small>
          </div>
          <div class="config-stat panel-surface">
            <span class="config-stat__label">SSH 文件</span>
            <strong>{{ overview?.configFileCount ?? 0 }}</strong>
            <small>{{ overview?.includeCount ?? 0 }} 个 Include 文件</small>
          </div>
          <div class="config-stat panel-surface" :class="{ 'is-risk': overview?.configStale || overview?.drift }">
            <span class="config-stat__label">配置状态</span>
            <strong>{{ statusLabel }}</strong>
            <small>{{ lastGeneratedLabel }}</small>
          </div>
        </div>

        <div class="config-overview__columns">
          <div class="panel-surface path-card">
            <div class="panel-heading">
              <div>
                <span class="eyebrow">SOURCE & ARTIFACT</span>
                <h3>配置位置</h3>
              </div>
              <el-button text :icon="FolderOpened" @click="revealPath(overview?.panelPath || '')">定位</el-button>
            </div>
            <div class="path-row">
              <span class="path-row__label">Panel JSON</span>
              <code :title="overview?.panelPath">{{ compactPath(overview?.panelPath) }}</code>
              <el-button text :icon="View" @click="openSection('json')">查看</el-button>
            </div>
            <div class="path-row">
              <span class="path-row__label">SSH config</span>
              <code :title="overview?.sshConfigPath">{{ compactPath(overview?.sshConfigPath) }}</code>
              <el-button text :icon="View" @click="openSection('files')">查看</el-button>
            </div>
            <div class="path-row path-row--muted">
              <span class="path-row__label">Include</span>
              <code>~/.ssh/config.d/*.conf</code>
              <el-button text :icon="FolderOpened" @click="revealPath('config.d')">定位</el-button>
            </div>
          </div>

          <div class="panel-surface impact-card">
            <div class="panel-heading">
              <div>
                <span class="eyebrow">WHAT NEEDS ATTENTION</span>
                <h3>影响摘要</h3>
              </div>
              <el-button text type="primary" @click="openSection('diff')">查看全部</el-button>
            </div>
            <div v-if="impactItems.length" class="impact-list">
              <div v-for="item in impactItems" :key="item.key" class="impact-item">
                <span class="impact-item__dot" :class="`is-${item.type}`" />
                <span>{{ item.label }}</span>
                <strong>{{ item.count }}</strong>
              </div>
            </div>
            <div v-else class="empty-inline"><el-icon><CircleCheckFilled /></el-icon> 当前没有待处理差异</div>
          </div>
        </div>

        <div class="panel-surface overview-footer">
          <div>
            <span class="eyebrow">RECOVERY</span>
            <h3>最近备份</h3>
            <p v-if="overview?.lastBackup">
              {{ formatTime(overview.lastBackup.createdAt) }} · {{ overview.lastBackup.hostCount }} 台主机 ·
              {{ overview.lastBackup.fileCount }} 个配置文件
            </p>
            <p v-else>尚未生成自动备份。每次提交、导入、生成和恢复前都会创建快照。</p>
          </div>
          <div class="overview-footer__actions">
            <el-button :icon="Clock" @click="openSection('backups')">备份与恢复</el-button>
            <el-button :icon="Lock" @click="exportEncrypted">加密导出</el-button>
          </div>
        </div>
      </section>

      <section v-else-if="section === 'json'" class="editor-workspace">
        <div class="editor-workspace__header">
          <div>
            <div class="eyebrow">PANEL JSON · MASKED BY DEFAULT</div>
            <h2>Panel 状态草稿</h2>
            <p>可以编辑主机、分组和额外 SSH 选项。Revision、布局和 stale 状态由后端托管。</p>
          </div>
          <div class="editor-workspace__actions">
            <el-button text :icon="passwordVisible ? Hide : View" @click="togglePasswords">
              {{ passwordVisible ? "隐藏敏感字段" : "显示敏感字段" }}
            </el-button>
            <el-button text :icon="FolderOpened" @click="openPanelJsonPath">系统编辑器</el-button>
            <el-button text :icon="Location" @click="revealPanelJsonPath">定位</el-button>
            <el-button :icon="Refresh" :loading="busy" @click="loadJson(false)">重新加载</el-button>
            <el-button type="primary" :icon="Check" :loading="busy" @click="previewJson">
              校验并预览
            </el-button>
          </div>
        </div>
        <div class="editor-workspace__editor">
          <CodeEditor v-model="jsonText" language="json" />
        </div>
        <div class="editor-workspace__hint" :class="{ 'is-dirty': jsonDirty }">
          <span>{{ jsonDirty ? "草稿未保存" : "当前草稿与已加载的 Panel 状态一致" }}</span>
          <span>密码占位符 {{ passwordMask }} 不会覆盖原密码；清空字段才会清除密码。</span>
        </div>
      </section>

      <section v-else-if="section === 'files'" class="file-workspace">
        <aside class="file-tree panel-surface">
          <div class="file-tree__header">
            <div>
              <div class="eyebrow">CONFIG TREE</div>
              <h3>文件树</h3>
            </div>
            <el-button text :icon="Refresh" :loading="loading" @click="refreshAll" />
          </div>
          <button
            v-for="file in configFiles"
            :key="file.path"
            type="button"
            class="file-tree__item"
            :class="{ 'is-active': file.path === selectedFilePath, 'is-dirty': dirtyFilePaths.has(file.path) }"
            @click="selectFile(file.path)"
          >
            <el-icon><component :is="file.panelJson ? Document : file.path === 'config' ? Setting : FolderOpened" /></el-icon>
            <span class="file-tree__name">{{ file.panelJson ? "Panel JSON" : file.path }}</span>
            <span v-if="dirtyFilePaths.has(file.path)" class="file-tree__dirty">●</span>
            <span v-else-if="file.externalChanged" class="file-tree__external">外部</span>
          </button>
          <div class="file-tree__footer">
            <el-button text :icon="FolderOpened" @click="revealPath('config.d')">打开 config.d</el-button>
          </div>
        </aside>

        <div class="file-editor panel-surface">
          <div class="file-editor__header">
            <div class="file-editor__title">
              <span class="eyebrow">{{ selectedFile?.source || "OPENSSH CONFIG" }}</span>
              <h2>{{ selectedFile?.path || "config" }}</h2>
              <code :title="selectedFile?.absolutePath">{{ compactPath(selectedFile?.absolutePath) }}</code>
            </div>
            <div class="editor-workspace__actions">
              <el-tag v-if="selectedFile?.generated" type="info" effect="plain">Panel 生成</el-tag>
              <el-tag v-if="selectedFile?.externalChanged" type="warning" effect="plain">磁盘已变化</el-tag>
              <el-button text :icon="FolderOpened" @click="openSelectedPath">系统编辑器</el-button>
              <el-button text :icon="Location" @click="revealSelectedPath">定位</el-button>
              <el-button type="primary" :icon="Check" :loading="busy" :disabled="dirtyFilePaths.size === 0" @click="previewFiles">
                校验并预览
              </el-button>
            </div>
          </div>
          <div class="file-editor__body">
            <CodeEditor v-model="currentFileText" language="ssh" />
          </div>
          <div class="file-editor__footer">
            <span>{{ fileDirty ? "草稿未保存，提交时会先导入 Panel JSON 再生成配置" : "文件内容来自当前磁盘快照" }}</span>
            <span v-if="selectedFile">{{ formatBytes(selectedFile.size) }} · {{ formatMode(selectedFile.mode) }} · {{ formatTime(selectedFile.updatedAt) }}</span>
          </div>
        </div>
      </section>

      <section v-else-if="section === 'diff'" class="diff-workspace">
        <div class="editor-workspace__header">
          <div>
            <div class="eyebrow">THREE-WAY REVIEW</div>
            <h2>差异与冲突</h2>
            <p>磁盘文件、Panel 快照和待生成结果分开显示；冲突不会被自动覆盖。</p>
          </div>
          <div class="editor-workspace__actions">
            <el-button v-if="overview?.drift || overview?.needsReview" type="warning" :icon="Upload" :loading="busy" @click="previewExternalImport">
              预览外部导入
            </el-button>
            <el-button type="primary" :icon="Refresh" :loading="loading" @click="refreshAll">重新扫描</el-button>
          </div>
        </div>
        <div v-if="overview?.diff.changedFiles?.length || overview?.diff.hostDiff?.length" class="diff-list">
          <div v-for="file in overview?.diff.changedFiles || []" :key="file.path" class="diff-card panel-surface">
            <div class="diff-card__heading">
              <div><span class="diff-kind" :class="`is-${file.kind}`">{{ diffKindLabel(file.kind) }}</span><strong>{{ file.path }}</strong></div>
              <el-button text @click="selectFile(file.path)">打开文件</el-button>
            </div>
            <div class="diff-card__hashes">
              <span>Panel {{ shortHash(file.panelSha256) || "—" }}</span>
              <span>磁盘 {{ shortHash(file.externalSha256) || "—" }}</span>
              <span>生成 {{ shortHash(file.generatedSha256) || "—" }}</span>
            </div>
          </div>
          <div v-for="host in overview?.diff.hostDiff || []" :key="host.alias" class="diff-card panel-surface">
            <div class="diff-card__heading">
              <div><span class="diff-kind" :class="`is-${host.kind}`">{{ diffKindLabel(host.kind) }}</span><strong>{{ host.alias }}</strong></div>
              <span class="diff-card__fields">{{ host.fields?.join(" · ") || "结构变化" }}</span>
            </div>
          </div>
        </div>
        <div v-else class="diff-empty panel-surface">
          <el-icon><CircleCheckFilled /></el-icon>
          <h3>配置树一致</h3>
          <p>当前没有检测到磁盘与 Panel 快照之间的变化。</p>
        </div>
      </section>

      <section v-else class="backup-workspace">
        <div class="editor-workspace__header">
          <div>
            <div class="eyebrow">RECOVERY TIMELINE</div>
            <h2>备份与恢复</h2>
            <p>自动快照最多保留 50 份；普通导出脱敏，加密导出才包含密码。</p>
          </div>
          <div class="editor-workspace__actions">
            <el-button :icon="Lock" @click="exportEncrypted">加密导出</el-button>
            <el-button :icon="Refresh" :loading="loading" @click="loadBackups">刷新时间线</el-button>
          </div>
        </div>
        <div class="backup-layout">
          <div class="backup-list panel-surface">
            <button
              v-for="backup in backups"
              :key="backup.id"
              type="button"
              class="backup-item"
              :class="{ 'is-active': backup.id === selectedBackupId }"
              @click="selectBackup(backup.id)"
            >
              <span class="backup-item__date">{{ formatTime(backup.createdAt) }}</span>
              <strong>Revision {{ backup.revision }}</strong>
              <span>{{ backup.hostCount }} 台主机 · {{ backup.fileCount }} 个文件</span>
            </button>
            <el-empty v-if="!backups.length" description="暂无自动备份" />
          </div>
          <div class="backup-detail panel-surface">
            <template v-if="backupDetail">
              <div class="panel-heading">
                <div><span class="eyebrow">SNAPSHOT</span><h3>{{ formatTime(backupDetail.summary.createdAt) }}</h3></div>
                <el-button type="warning" :icon="Back" @click="restoreBackup">恢复此快照</el-button>
              </div>
              <div class="backup-detail__meta">
                <span>Revision {{ backupDetail.summary.revision }}</span>
                <span>{{ formatBytes(backupDetail.summary.size) }}</span>
                <span>{{ backupDetail.summary.path }}</span>
              </div>
              <div class="backup-detail__files">
                <div v-for="file in backupDetail.files || []" :key="file.path" class="backup-file">
                  <el-icon><Document /></el-icon><code>{{ file.path }}</code><span>{{ shortHash(file.sha256) }}</span>
                </div>
              </div>
              <p class="backup-detail__note">恢复会同时回滚 Panel JSON 与 SSH 文件树，恢复前会先创建当前状态快照；不要求远程主机在线。</p>
            </template>
            <el-empty v-else description="选择一个快照查看详情" />
          </div>
        </div>
      </section>
    </div>

    <el-dialog v-model="previewOpen" title="提交前预览" width="1120px" class="config-preview-dialog" destroy-on-close>
      <template v-if="preview">
        <div class="preview-banner" :class="{ 'is-invalid': !preview.valid }">
          <div>
            <span class="eyebrow">{{ preview.source === "config" ? "CONFIG DRAFT" : "PANEL JSON DRAFT" }}</span>
            <strong>{{ preview.valid ? "可以提交" : "需要处理后才能提交" }}</strong>
          </div>
          <span>基于 Revision {{ preview.baseRevision }} · {{ formatTime(preview.expiresAt) }} 过期</span>
        </div>
        <el-alert v-if="preview.error" :type="preview.valid ? 'info' : 'error'" :closable="false" show-icon :title="preview.error" />

        <div class="preview-section">
          <div class="preview-section__title"><h3>连接测试</h3><span>{{ preview.affectedHosts?.length || 0 }} 台受影响主机</span></div>
          <div v-if="preview.connectionTests?.length" class="test-grid">
            <div v-for="test in preview.connectionTests" :key="test.alias" class="test-row">
              <span class="test-row__status" :class="test.success ? 'is-ok' : 'is-fail'">{{ test.success ? "通过" : "失败" }}</span>
              <strong>{{ test.alias }}</strong>
              <span>{{ test.success ? test.message : test.error }}</span>
              <small>{{ test.durationMs }} ms</small>
            </div>
          </div>
          <div v-else class="empty-inline">仅修改布局、备注或注释，无需远程连通性测试。</div>
        </div>

        <div v-if="preview.conflicts?.length" class="preview-section">
          <div class="preview-section__title"><h3>逐项解决冲突</h3><span>全部解决后才可提交</span></div>
          <div v-for="conflict in preview.conflicts" :key="conflict.id" class="conflict-row">
            <div class="conflict-row__copy"><strong>{{ conflict.alias || conflict.file || "配置项" }}</strong><span>{{ conflict.summary }}</span></div>
            <el-select v-model="conflictChoices[conflict.id]" class="conflict-row__choice" placeholder="选择处理方式">
              <el-option label="保留 Panel" value="panel" />
              <el-option label="采用外部" value="external" />
              <el-option v-if="conflict.file" label="手工合并" value="manual" />
            </el-select>
            <el-input v-if="conflictChoices[conflict.id] === 'manual'" v-model="manualConflict[conflict.id]" type="textarea" :rows="3" class="conflict-row__manual" placeholder="输入最终文件内容" />
          </div>
          <el-button type="warning" :loading="busy" @click="resolveConflicts">应用冲突选择并重新预览</el-button>
        </div>

        <div class="preview-section">
          <div class="preview-section__title"><h3>文件与主机影响</h3><span>{{ preview.fileDiff?.length || 0 }} 个文件 · {{ preview.hostDiff?.length || 0 }} 台主机</span></div>
          <div class="preview-file-list">
            <button v-for="file in preview.fileDiff || []" :key="file.path" type="button" class="preview-file-row" :class="{ 'is-selected': file.path === previewFilePath }" @click="previewFilePath = file.path">
              <span class="diff-kind" :class="`is-${file.kind}`">{{ diffKindLabel(file.kind) }}</span>
              <code>{{ file.path }}</code>
              <span>{{ shortHash(file.externalSha256) || "—" }} → {{ shortHash(file.generatedSha256) || "—" }}</span>
            </button>
          </div>
          <div v-if="previewFile" class="three-way-diff">
            <div class="three-way-diff__pane">
              <div class="three-way-diff__title">Panel 快照</div>
              <CodeEditor :model-value="previewFile.panelContent || ''" language="ssh" read-only />
            </div>
            <div class="three-way-diff__pane">
              <div class="three-way-diff__title">当前磁盘</div>
              <CodeEditor :model-value="previewFile.externalContent || ''" language="ssh" read-only />
            </div>
            <div class="three-way-diff__pane">
              <div class="three-way-diff__title">待生成结果</div>
              <CodeEditor :model-value="previewFile.generatedContent || ''" language="ssh" read-only />
            </div>
          </div>
          <div v-for="host in preview.hostDiff || []" :key="`host-${host.alias}`" class="preview-host-row">
            <span class="diff-kind" :class="`is-${host.kind}`">{{ diffKindLabel(host.kind) }}</span>
            <strong>{{ host.alias }}</strong>
            <span>{{ host.fields?.join(" · ") || "结构变化" }}</span>
          </div>
        </div>
      </template>
      <template #footer>
        <el-button @click="previewOpen = false">取消</el-button>
        <el-button type="primary" :loading="busy" :disabled="!preview?.valid" @click="commitPreview">确认备份并提交</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="editorPickerOpen" title="选择系统编辑器" width="520px" class="editor-picker-dialog" destroy-on-close>
      <div class="editor-picker__intro">
        <span>选择一个已安装的应用打开当前配置文件。</span>
        <code :title="editorTargetPath">{{ compactPath(editorTargetPath) }}</code>
      </div>
      <div v-loading="editorLoading" class="editor-picker">
        <button
          v-for="editor in systemEditors"
          :key="editor.id"
          type="button"
          class="editor-picker__item"
          :class="{ 'is-default': editor.systemDefault }"
          :disabled="editorLoading || launchingEditorID === editor.id"
          @click="launchEditor(editor)"
        >
          <span class="editor-picker__icon"><el-icon><EditPen /></el-icon></span>
          <span class="editor-picker__copy">
            <strong>{{ editor.name }}</strong>
            <small>{{ editor.path }}</small>
          </span>
          <el-tag v-if="editor.systemDefault" size="small" effect="plain">默认</el-tag>
          <el-icon v-if="launchingEditorID === editor.id" class="is-loading"><Refresh /></el-icon>
        </button>
        <el-empty v-if="!editorLoading && !systemEditors.length" description="没有发现可用的系统编辑器" />
      </div>
      <template #footer>
        <span class="editor-picker__footer-hint">应用列表来自当前系统，每次打开时重新扫描。</span>
        <el-button @click="editorPickerOpen = false">取消</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { Dialogs, Events } from "@wailsio/runtime";
import {
  Back,
  Check,
  CircleCheckFilled,
  Clock,
  Document,
  EditPen,
  Files,
  FolderOpened,
  Hide,
  Location,
  Lock,
  Refresh,
  Setting,
  Upload,
  View,
} from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { api } from "@/api";
import type { main, panelsync } from "@/api";
import CodeEditor from "@/components/CodeEditor.vue";
import { useAppStore, type ConfigSection } from "@/stores/app";
import { formatErr } from "@/utils/format";

const app = useAppStore();
const section = computed(() => app.configSection);
const sections: { id: ConfigSection; label: string; icon: typeof Files }[] = [
  { id: "overview", label: "概览", icon: Files },
  { id: "json", label: "Panel JSON", icon: Document },
  { id: "files", label: "SSH 文件", icon: Setting },
  { id: "diff", label: "差异与冲突", icon: Upload },
  { id: "backups", label: "备份", icon: Clock },
];

const loading = ref(false);
const busy = ref(false);
const errorMessage = ref("");
const overview = ref<main.PanelConfigOverview | null>(null);
const configFiles = ref<main.PanelConfigFile[]>([]);
const selectedFilePath = ref(app.configFilePath || "config");
const currentFileText = ref("");
const fileDrafts = reactive<Record<string, string>>({});
const dirtyFilePaths = reactive(new Set<string>());
const hydratingFile = ref(false);
const jsonText = ref("");
const jsonDirty = ref(false);
const hydratingJson = ref(false);
const passwordVisible = ref(false);
const passwordMask = "••••••••";
const backups = ref<main.PanelBackupSummary[]>([]);
const selectedBackupId = ref("");
const backupDetail = ref<main.PanelBackup | null>(null);
const preview = ref<main.PanelConfigPreview | null>(null);
const previewOpen = ref(false);
const previewFilePath = ref("");
const conflictChoices = reactive<Record<string, string>>({});
const manualConflict = reactive<Record<string, string>>({});
const editorPickerOpen = ref(false);
const editorLoading = ref(false);
const launchingEditorID = ref("");
const editorTargetPath = ref("");
const systemEditors = ref<main.PanelSystemEditor[]>([]);
let offImported: (() => void) | null = null;
let offReview: (() => void) | null = null;
let offError: (() => void) | null = null;

const selectedFile = computed(() => configFiles.value.find((file) => file.path === selectedFilePath.value) || null);
const fileDirty = computed(() => dirtyFilePaths.has(selectedFilePath.value));
const statusLabel = computed(() => {
  if (!overview.value) return "检测中";
  if (overview.value.needsReview) return "需人工解决";
  if (overview.value.configStale) return "配置待生成";
  if (overview.value.drift) return "外部有修改";
  return "正常";
});
const statusType = computed(() => {
  if (!overview.value) return "info";
  if (overview.value.needsReview || overview.value.configStale) return "danger";
  if (overview.value.drift) return "warning";
  return "success";
});
const conflictCount = computed(() => overview.value?.diff.conflicts?.length || 0);
const lastGeneratedLabel = computed(() => overview.value?.lastGenerated ? formatTime(overview.value.lastGenerated) : "尚未生成");
const impactItems = computed(() => {
  const diff = overview.value?.diff;
  if (!diff) return [];
  return [
    { key: "added", label: "新增主机", count: diff.addedHosts?.length || 0, type: "added" },
    { key: "removed", label: "删除主机", count: diff.removedHosts?.length || 0, type: "removed" },
    { key: "changed", label: "主机字段变化", count: diff.changedHosts?.length || 0, type: "changed" },
    { key: "files", label: "文件变化", count: diff.changedFiles?.length || 0, type: "changed" },
    { key: "conflicts", label: "待解决冲突", count: diff.conflicts?.length || 0, type: "danger" },
  ].filter((item) => item.count > 0);
});
const previewFile = computed(() => preview.value?.fileDiff?.find((file) => file.path === previewFilePath.value) || preview.value?.fileDiff?.[0] || null);

function openSection(value: ConfigSection) {
  app.setConfigSection(value);
  if (value === "json" && !jsonText.value) void loadJson(false);
  if (value === "files" && !configFiles.value.length) void loadTree();
  if (value === "backups" && !backups.value.length) void loadBackups();
}

async function refreshAll() {
  loading.value = true;
  errorMessage.value = "";
  try {
    const [nextOverview, nextFiles] = await Promise.all([
      api.getPanelConfigOverview(),
      api.getPanelConfigTree(),
    ]);
    overview.value = nextOverview;
    configFiles.value = nextFiles;
    if (!selectedFile.value && nextFiles.length) {
      selectedFilePath.value = nextFiles.find((file) => !file.panelJson)?.path || nextFiles[0]!.path;
      app.setConfigFilePath(selectedFilePath.value);
    }
    hydrateSelectedFile();
    if (section.value === "json" && !jsonDirty.value) await loadJson(false);
    if (section.value === "backups") await loadBackups();
  } catch (error) {
    errorMessage.value = formatErr(error);
  } finally {
    loading.value = false;
  }
}

async function loadTree() {
  try {
    configFiles.value = await api.getPanelConfigTree();
    hydrateSelectedFile();
  } catch (error) {
    errorMessage.value = formatErr(error);
  }
}

function hydrateSelectedFile() {
  const file = selectedFile.value;
  if (!file) return;
  hydratingFile.value = true;
  currentFileText.value = fileDrafts[file.path] ?? file.content;
  void nextTick(() => {
    hydratingFile.value = false;
  });
}

function selectFile(path: string) {
  const file = configFiles.value.find((item) => item.path === path);
  if (!file) return;
  if (file.panelJson) {
    openSection("json");
    return;
  }
  selectedFilePath.value = path;
  app.setConfigFilePath(path);
  hydrateSelectedFile();
  openSection("files");
}

watch(currentFileText, (value) => {
  if (hydratingFile.value || !selectedFile.value) return;
  fileDrafts[selectedFile.value.path] = value;
  if (value === selectedFile.value.content) dirtyFilePaths.delete(selectedFile.value.path);
  else dirtyFilePaths.add(selectedFile.value.path);
});

watch(jsonText, (value, previous) => {
  if (hydratingJson.value || !previous || value === previous) return;
  jsonDirty.value = true;
});

async function loadJson(reveal: boolean) {
  try {
    const state = reveal ? await api.getEditablePanelStateSensitive() : await api.getEditablePanelState();
    hydratingJson.value = true;
    jsonText.value = JSON.stringify(state, null, 2);
    jsonDirty.value = false;
    passwordVisible.value = reveal;
    void nextTick(() => {
      hydratingJson.value = false;
    });
  } catch (error) {
    errorMessage.value = formatErr(error);
  }
}

async function togglePasswords() {
  if (passwordVisible.value) {
    if (jsonDirty.value) {
      try {
        await ElMessageBox.confirm("隐藏敏感字段会重新加载当前 JSON 草稿，未提交的编辑会丢失。", "重新加载脱敏 JSON", { confirmButtonText: "重新加载", cancelButtonText: "取消", type: "warning" });
      } catch {
        return;
      }
    }
    await loadJson(false);
    return;
  }
  await loadJson(true);
}

function parseJsonDraft(): main.PanelStateDraft | null {
  try {
    const parsed = JSON.parse(jsonText.value) as main.PanelStateDraft;
    if (!parsed || !Array.isArray(parsed.hosts) || !Array.isArray(parsed.groups)) throw new Error("必须包含 hosts 和 groups 数组");
    return parsed;
  } catch (error) {
    ElMessage.error(`Panel JSON 无效：${formatErr(error)}`);
    return null;
  }
}

async function previewJson() {
  const draft = parseJsonDraft();
  if (!draft) return;
  busy.value = true;
  try {
    await showPreview(await api.previewPanelState(draft));
  } catch (error) {
    ElMessage.error(formatErr(error));
  } finally {
    busy.value = false;
  }
}

function draftFiles(): panelsync.ConfigFile[] {
  return configFiles.value
    .filter((file) => !file.panelJson)
    .map((file) => ({
      path: file.path,
      content: fileDrafts[file.path] ?? file.content,
      mode: file.mode,
      sha256: file.sha256,
    }));
}

async function previewFiles() {
  busy.value = true;
  try {
    await showPreview(await api.previewConfigDraft({ files: draftFiles() }));
  } catch (error) {
    ElMessage.error(formatErr(error));
  } finally {
    busy.value = false;
  }
}

async function previewExternalImport() {
  busy.value = true;
  try {
    const tree = await api.getPanelConfigTree();
    configFiles.value = tree;
    const files = tree.filter((file) => !file.panelJson).map((file) => ({ path: file.path, content: file.content, mode: file.mode, sha256: file.sha256 }));
    await showPreview(await api.previewConfigDraft({ files }));
  } catch (error) {
    ElMessage.error(formatErr(error));
  } finally {
    busy.value = false;
  }
}

async function showPreview(value: main.PanelConfigPreview) {
  preview.value = value;
  previewOpen.value = true;
  previewFilePath.value = value.fileDiff?.[0]?.path || "";
  for (const conflict of value.conflicts || []) {
    if (!conflictChoices[conflict.id]) conflictChoices[conflict.id] = conflict.file ? "panel" : "panel";
    if (manualConflict[conflict.id] === undefined) manualConflict[conflict.id] = conflict.external || "";
  }
}

async function resolveConflicts() {
  if (!preview.value) return;
  busy.value = true;
  try {
    const resolutions = (preview.value.conflicts || []).map((conflict) => ({ id: conflict.id, choice: conflictChoices[conflict.id] || "panel", manual: manualConflict[conflict.id] || "" }));
    await showPreview(await api.resolveConfigConflicts(preview.value.previewId, resolutions));
  } catch (error) {
    ElMessage.error(formatErr(error));
  } finally {
    busy.value = false;
  }
}

async function commitPreview() {
  if (!preview.value?.valid) return;
  busy.value = true;
  try {
    await api.commitPanelPreview(preview.value.previewId);
    previewOpen.value = false;
    ElMessage.success("已备份并提交 Panel JSON 与 SSH 配置");
    jsonDirty.value = false;
    dirtyFilePaths.clear();
    for (const key of Object.keys(fileDrafts)) delete fileDrafts[key];
    await refreshAll();
    void app.refresh();
  } catch (error) {
    ElMessage.error(formatErr(error));
    await refreshAll();
  } finally {
    busy.value = false;
  }
}

async function loadBackups() {
  try {
    backups.value = await api.listPanelBackups();
    if (selectedBackupId.value && backups.value.some((backup) => backup.id === selectedBackupId.value)) {
      await selectBackup(selectedBackupId.value);
    } else if (backups.value[0]) {
      await selectBackup(backups.value[0].id);
    }
  } catch (error) {
    errorMessage.value = formatErr(error);
  }
}

async function selectBackup(id: string) {
  selectedBackupId.value = id;
  try {
    backupDetail.value = await api.getPanelBackup(id);
  } catch (error) {
    errorMessage.value = formatErr(error);
  }
}

async function restoreBackup() {
  if (!backupDetail.value) return;
  try {
    await ElMessageBox.confirm(
      `将恢复 ${formatTime(backupDetail.value.summary.createdAt)} 的 Panel JSON 与 SSH 文件树。当前状态会先自动备份，恢复不要求服务器在线。`,
      "恢复配置快照",
      { confirmButtonText: "恢复", cancelButtonText: "取消", type: "warning" },
    );
  } catch {
    return;
  }
  busy.value = true;
  try {
    await api.restorePanelBackup(backupDetail.value.summary.id);
    ElMessage.success("配置快照已恢复");
    await refreshAll();
    await loadBackups();
    void app.refresh();
  } catch (error) {
    ElMessage.error(formatErr(error));
  } finally {
    busy.value = false;
  }
}

async function exportEncrypted() {
  const path = await Dialogs.SaveFile({ Title: "导出加密 Panel 备份", Filename: "1pannel-backup.age", CanCreateDirectories: true, CanChooseDirectories: false, CanChooseFiles: true });
  if (!path) return;
  try {
    const { value } = await ElMessageBox.prompt("完整导出包含 Panel JSON 中的密码，请设置一个不会被 Panel 保存的口令。", "加密导出", { confirmButtonText: "导出", cancelButtonText: "取消", inputType: "password", inputPlaceholder: "导出口令" });
    if (!value) return;
    await api.exportEncryptedPanelBackup(path, value);
    ElMessage.success("已生成 age 加密备份");
  } catch (error) {
    if (error !== "cancel" && !(error instanceof Error && error.message === "cancel")) ElMessage.error(formatErr(error));
  }
}

async function openSelectedPath() {
  if (selectedFile.value) await openEditorPicker(selectedFile.value.absolutePath);
}

async function openPanelJsonPath() {
  const file = configFiles.value.find((item) => item.panelJson);
  if (file) await openEditorPicker(file.absolutePath);
}

async function openEditorPicker(path: string) {
  if (!path) return;
  editorTargetPath.value = path;
  editorPickerOpen.value = true;
  editorLoading.value = true;
  try {
    systemEditors.value = await api.listSystemEditors();
  } catch (error) {
    editorPickerOpen.value = false;
    ElMessage.error(formatErr(error));
  } finally {
    editorLoading.value = false;
  }
}

async function launchEditor(editor: main.PanelSystemEditor) {
  if (!editorTargetPath.value || launchingEditorID.value) return;
  launchingEditorID.value = editor.id;
  try {
    await api.openPanelPathWithEditor(editorTargetPath.value, editor.id);
    editorPickerOpen.value = false;
    localStorage.setItem("1pannel.config.editor", editor.id);
  } catch (error) {
    ElMessage.error(formatErr(error));
  } finally {
    launchingEditorID.value = "";
  }
}

async function revealPanelJsonPath() {
  const file = configFiles.value.find((item) => item.panelJson);
  if (file) await api.revealPanelPath(file.absolutePath);
}

async function revealSelectedPath() {
  if (selectedFile.value) await api.revealPanelPath(selectedFile.value.absolutePath);
}

async function revealPath(path: string) {
  if (path) await api.revealPanelPath(path);
}

function compactPath(path?: string) {
  if (!path) return "—";
  const home = "/Users/";
  return path.length > 62 ? `…${path.slice(-59)}` : path.replace(home, "~/");
}

function formatTime(value: number) {
  if (!value) return "—";
  return new Date(value * 1000).toLocaleString();
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatMode(mode: number) {
  return mode ? `0${mode.toString(8)}` : "0600";
}

function shortHash(value?: string) {
  return value ? value.slice(0, 8) : "";
}

function diffKindLabel(kind: string) {
  if (kind === "added") return "新增";
  if (kind === "removed") return "删除";
  if (kind === "changed") return "变化";
  return "结构";
}

onMounted(() => {
  void refreshAll();
  offImported = Events.On("panel-config-imported", () => {
    if (jsonDirty.value || dirtyFilePaths.size) {
      errorMessage.value = "检测到外部配置变化；当前草稿已暂停自动覆盖，请先处理差异。";
      return;
    }
    void refreshAll();
  });
  offReview = Events.On("panel-config-needs-review", () => {
    void refreshAll();
  });
  offError = Events.On("panel-config-import-error", () => {
    void refreshAll();
  });
});

onBeforeUnmount(() => {
  offImported?.();
  offReview?.();
  offError?.();
  offImported = null;
  offReview = null;
  offError = null;
  passwordVisible.value = false;
});
</script>

<style scoped lang="scss">
.config-center {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: 14px 16px 16px;
  gap: 14px;
  background: #f3f6fa;
  color: var(--m3-on-surface);
}

.config-center__toolbar,
.editor-workspace__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-shrink: 0;
}

.config-center__tabs {
  display: flex;
  align-items: center;
  gap: 4px;
}

.config-center__tab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 11px;
  border: 0;
  border-radius: 9px;
  color: #617084;
  background: transparent;
  font: var(--m3-label-large);
  cursor: pointer;
  transition: 140ms ease;

  &:hover { color: #244b80; background: #e6edf6; }
  &.is-active { color: #1758b5; background: #dceaff; font-weight: 700; }
}

.config-center__tab-count,
.file-tree__dirty {
  color: #a33c1d;
  font-size: 10px;
  font-weight: 800;
}

.config-center__actions,
.editor-workspace__actions,
.overview-footer__actions {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.config-center__error { flex-shrink: 0; }
.config-center__content { flex: 1; min-height: 0; overflow: auto; }

.panel-surface {
  border: 1px solid #dce4ee;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 2px 10px rgba(44, 74, 112, 0.045);
}

.config-overview { display: flex; flex-direction: column; gap: 14px; min-height: 100%; }
.config-overview__hero { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; padding: 22px 24px; background: linear-gradient(115deg, #fff 0%, #f1f6fd 100%); }
.config-overview__hero h2, .editor-workspace__header h2 { margin: 5px 0 6px; font-size: 21px; letter-spacing: -0.02em; }
.config-overview__hero p, .editor-workspace__header p { max-width: 680px; margin: 0; color: #6f7d91; font-size: 12px; line-height: 1.6; }
.eyebrow { color: #7890ad; font-size: 10px; font-weight: 800; letter-spacing: .12em; }
.config-overview__hero-actions { display: flex; gap: 8px; flex-shrink: 0; }
.config-stat-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.config-stat { display: flex; flex-direction: column; gap: 5px; padding: 15px 17px; }
.config-stat__label { color: #78879a; font-size: 11px; }
.config-stat strong { color: #17355d; font-size: 23px; letter-spacing: -.03em; }
.config-stat small { color: #94a0af; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.config-stat.is-risk { border-color: #f0c8b9; background: #fffaf8; }
.config-stat.is-risk strong { color: #a33c1d; font-size: 16px; }
.config-overview__columns { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(320px, .8fr); gap: 14px; }
.path-card, .impact-card, .overview-footer { padding: 17px 19px; }
.panel-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.panel-heading h3 { margin: 4px 0 0; font-size: 15px; }
.path-row { display: grid; grid-template-columns: 82px minmax(0, 1fr) auto; align-items: center; gap: 10px; min-height: 40px; border-bottom: 1px solid #edf1f5; }
.path-row:last-child { border-bottom: 0; }
.path-row__label { color: #77869a; font-size: 11px; }
code { color: #40546d; font-family: "SF Mono", "SFMono-Regular", Menlo, Consolas, monospace; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.path-row--muted code, .path-row--muted .path-row__label { color: #9aa6b5; }
.impact-list { margin-top: 10px; }
.impact-item { display: flex; align-items: center; gap: 9px; min-height: 34px; color: #69788d; font-size: 12px; }
.impact-item strong { margin-left: auto; color: #263c5a; }
.impact-item__dot { width: 7px; height: 7px; border-radius: 50%; background: #6798d8; }
.impact-item__dot.is-danger, .impact-item__dot.is-removed { background: #d66d4c; }
.impact-item__dot.is-added { background: #56a884; }
.empty-inline { display: flex; align-items: center; gap: 8px; color: #7e8d9d; font-size: 12px; }
.empty-inline .el-icon { color: #46a47a; }
.overview-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.overview-footer h3 { margin: 4px 0; font-size: 15px; }
.overview-footer p { margin: 0; color: #7a899c; font-size: 12px; }

.editor-workspace, .diff-workspace, .backup-workspace { display: flex; flex-direction: column; gap: 14px; min-height: 100%; }
.editor-workspace__editor { flex: 1; min-height: 420px; }
.editor-workspace__hint, .file-editor__footer { display: flex; justify-content: space-between; gap: 12px; color: #8996a7; font-size: 11px; }
.editor-workspace__hint.is-dirty { color: #b15a32; }
.file-workspace { display: grid; grid-template-columns: 245px minmax(0, 1fr); gap: 14px; min-height: 100%; }
.file-tree { display: flex; flex-direction: column; min-height: 0; padding: 14px 8px; }
.file-tree__header { display: flex; align-items: flex-start; justify-content: space-between; padding: 0 8px 10px; }
.file-tree__header h3 { margin: 4px 0 0; font-size: 15px; }
.file-tree__item { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 36px; padding: 0 9px; border: 0; border-radius: 8px; color: #67778c; background: transparent; text-align: left; cursor: pointer; }
.file-tree__item:hover { background: #f0f4f9; color: #294c79; }
.file-tree__item.is-active { color: #1758b5; background: #e6f0ff; font-weight: 700; }
.file-tree__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 11px "SF Mono", "SFMono-Regular", Menlo, monospace; }
.file-tree__external { margin-left: auto; color: #b26830; font-size: 9px; }
.file-tree__footer { margin-top: auto; padding: 12px 3px 0; border-top: 1px solid #edf1f5; }
.file-editor { display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 15px; }
.file-editor__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 0 2px 12px; }
.file-editor__title { min-width: 0; }
.file-editor__title h2 { margin: 5px 0 3px; font-size: 17px; }
.file-editor__title code { display: block; max-width: 460px; color: #8b98a8; }
.file-editor__body { flex: 1; min-height: 360px; }
.file-editor__footer { padding: 10px 2px 0; }

.diff-list { display: flex; flex-direction: column; gap: 9px; }
.diff-card { padding: 13px 15px; }
.diff-card__heading, .diff-card__hashes { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.diff-card__heading > div { display: flex; align-items: center; gap: 8px; min-width: 0; }
.diff-card__heading strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.diff-card__hashes { justify-content: flex-start; margin-top: 9px; color: #8a98a9; font: 10px "SF Mono", monospace; }
.diff-card__fields { color: #8290a0; font-size: 11px; }
.diff-kind { display: inline-flex; align-items: center; justify-content: center; min-width: 36px; padding: 3px 6px; border-radius: 5px; color: #61748d; background: #eef2f7; font-size: 9px; font-weight: 800; }
.diff-kind.is-added { color: #267955; background: #e2f4eb; }
.diff-kind.is-removed { color: #a7472a; background: #fff0eb; }
.diff-kind.is-changed { color: #9a641f; background: #fff3d9; }
.diff-empty { display: grid; place-items: center; align-content: center; min-height: 300px; color: #7b8a9d; text-align: center; }
.diff-empty .el-icon { color: #42a57b; font-size: 28px; }
.diff-empty h3 { margin: 10px 0 4px; color: #314968; }
.diff-empty p { margin: 0; font-size: 12px; }

.backup-layout { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 14px; min-height: 420px; flex: 1; }
.backup-list { min-height: 0; padding: 8px; overflow: auto; }
.backup-item { display: flex; flex-direction: column; align-items: flex-start; width: 100%; gap: 4px; padding: 12px; border: 0; border-radius: 9px; color: #718095; background: transparent; text-align: left; cursor: pointer; }
.backup-item:hover { background: #f2f5f9; }
.backup-item.is-active { color: #1d579f; background: #e7f0ff; }
.backup-item__date { color: #8795a6; font-size: 11px; }
.backup-item strong { color: #344c6a; font-size: 12px; }
.backup-item span:last-child { font-size: 11px; }
.backup-detail { min-width: 0; padding: 18px; }
.backup-detail__meta { display: flex; gap: 14px; margin: 16px 0; color: #8997a7; font-size: 11px; }
.backup-detail__meta span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: monospace; }
.backup-detail__files { display: flex; flex-direction: column; gap: 7px; padding: 12px 0; border-top: 1px solid #edf1f5; border-bottom: 1px solid #edf1f5; }
.backup-file { display: flex; align-items: center; gap: 8px; color: #64758b; }
.backup-file code { flex: 1; }
.backup-file span { color: #9aa7b6; font: 10px monospace; }
.backup-detail__note { color: #7d8c9f; font-size: 11px; line-height: 1.6; }

.preview-banner { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; padding: 12px 14px; border: 1px solid #c8e8d8; border-radius: 10px; color: #4b7b63; background: #f1fbf5; }
.preview-banner.is-invalid { border-color: #efc2b2; color: #a54b2c; background: #fff7f4; }
.preview-banner strong { display: block; margin-top: 3px; font-size: 15px; }
.preview-banner > span { color: #8b9aab; font-size: 11px; }
.preview-section { margin-top: 15px; }
.preview-section__title { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; }
.preview-section__title h3 { margin: 0; font-size: 14px; }
.preview-section__title span { color: #8b98a7; font-size: 11px; }
.test-grid, .preview-file-list { display: flex; flex-direction: column; gap: 5px; }
.test-row, .preview-file-row, .preview-host-row { display: grid; grid-template-columns: 48px minmax(110px, .35fr) minmax(0, 1fr) auto; align-items: center; gap: 9px; min-height: 32px; padding: 0 9px; border-radius: 6px; background: #f6f8fb; color: #6e7d8e; font-size: 11px; }
.preview-file-row { width: 100%; border: 0; text-align: left; cursor: pointer; }
.preview-file-row:hover, .preview-file-row.is-selected { background: #eaf2ff; }
.test-row strong, .preview-host-row strong { color: #334b68; }
.test-row small { color: #9aa7b6; }
.test-row__status { font-size: 10px; font-weight: 800; }
.test-row__status.is-ok { color: #2f8a64; }
.test-row__status.is-fail { color: #bd4e2e; }
.conflict-row { display: grid; grid-template-columns: minmax(0, 1fr) 150px; gap: 8px; align-items: center; margin-bottom: 8px; padding: 10px; border: 1px solid #f0d4c8; border-radius: 8px; background: #fffaf8; }
.conflict-row__copy { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.conflict-row__copy strong { color: #82432d; font-size: 12px; }
.conflict-row__copy span { color: #8b746b; font-size: 11px; }
.conflict-row__manual { grid-column: 1 / -1; }
.three-way-diff { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; min-height: 230px; margin-top: 8px; }
.three-way-diff__pane { display: flex; flex-direction: column; min-width: 0; min-height: 230px; }
.three-way-diff__title { padding: 7px 9px; border: 1px solid #dce4ee; border-bottom: 0; border-radius: 8px 8px 0 0; color: #6f8094; background: #f5f7fa; font-size: 10px; font-weight: 800; }
.three-way-diff__pane .code-editor { min-height: 210px; border-radius: 0 0 8px 8px; }
.editor-picker__intro { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; color: #718096; font-size: 12px; }
.editor-picker__intro code { color: #8b98a8; }
.editor-picker { display: flex; flex-direction: column; gap: 7px; min-height: 80px; }
.editor-picker__item { display: flex; align-items: center; gap: 11px; width: 100%; min-height: 58px; padding: 9px 11px; border: 1px solid #e2e8f0; border-radius: 10px; color: #40546d; background: #fff; text-align: left; cursor: pointer; transition: 140ms ease; }
.editor-picker__item:hover:not(:disabled) { border-color: #9fc2f3; background: #f5f9ff; box-shadow: 0 3px 10px rgba(39, 93, 164, 0.08); }
.editor-picker__item.is-default { border-style: dashed; }
.editor-picker__item:disabled { cursor: wait; opacity: .72; }
.editor-picker__icon { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 9px; color: #2367c7; background: #e7f0ff; font-size: 16px; }
.editor-picker__copy { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 3px; }
.editor-picker__copy strong { color: #294968; font-size: 13px; }
.editor-picker__copy small { overflow: hidden; color: #91a0b1; font: 10px "SF Mono", "SFMono-Regular", Menlo, monospace; text-overflow: ellipsis; white-space: nowrap; }
.editor-picker__footer-hint { margin-right: auto; color: #99a5b3; font-size: 11px; }

@media (max-width: 900px) {
  .config-overview__hero, .overview-footer, .editor-workspace__header { align-items: flex-start; flex-direction: column; }
  .config-stat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .config-overview__columns, .file-workspace, .backup-layout { grid-template-columns: 1fr; }
  .file-tree { max-height: 260px; }
  .three-way-diff { grid-template-columns: 1fr; }
}
</style>
