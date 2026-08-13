<template>
  <div class="main-container">
    <template v-if="!app.activeTab">
      <div class="content-pad">
        <AllHostsOverviewView />
      </div>
    </template>

    <!-- 分组视图：展示组内全部主机监控卡片 -->
    <template v-else-if="app.activeTab?.kind === 'group'">
      <div class="host-header">
        <div>
          <div class="name">{{ app.activeTab.title }}</div>
          <div class="sub">分组概览 · 组内全部主机</div>
        </div>
      </div>
      <div class="content-pad">
        <GroupOverviewView
          :group-id="app.activeTab.id"
          :group-name="app.activeTab.title"
        />
      </div>
    </template>

    <!-- 多主机会话：已打开的全部挂载，仅用 v-show 切换，避免销毁重载 -->
    <template v-for="hid in app.runningHosts" :key="hid">
      <div
        v-show="app.activeTab?.kind === 'host' && app.activeTab.id === hid"
        class="host-shell"
      >
        <div class="host-header">
          <div>
            <div class="name">
              {{ sessionOf(hid)?.title || hid }}
              <span class="run-badge" title="后台保持中">运行中</span>
            </div>
            <div class="sub">{{ sessionOf(hid)?.subtitle }}</div>
          </div>
          <div class="host-actions">
            <el-button
              size="small"
              :loading="zshBusy === hid"
              @click="onInitZsh(hid)"
            >
              初始化 zsh
            </el-button>
            <el-button
              text
              type="danger"
              size="small"
              @click="app.stopHost(hid)"
            >
              停止会话
            </el-button>
          </div>
        </div>

        <div class="router-tabs">
          <el-radio-group
            :model-value="sessionOf(hid)?.subTab || 'overview'"
            size="default"
            @change="(v: string | number | boolean | undefined) => onSubChange(hid, v)"
          >
            <el-radio-button
              v-for="t in subTabs"
              :key="t.value"
              :value="t.value"
            >
              {{ t.label }}
            </el-radio-button>
          </el-radio-group>
        </div>

        <div
          class="content-pad"
          :class="{
            'content-pad--fill': isFillSub(sessionOf(hid)?.subTab),
          }"
        >
          <!-- 各子页按会话 subTab 挂载；非当前子页用 v-show 藏起也可保留状态。
               为控制内存：非 overview 的子页仅在选中该 subTab 时挂载；
               overview 始终挂载以便后台轮询。 -->
          <OverviewView
            v-show="(sessionOf(hid)?.subTab || 'overview') === 'overview'"
            :host="hid"
          />
          <ProcessesView
            v-if="sessionOf(hid)?.subTab === 'processes'"
            :host="hid"
          />
          <NetworkView
            v-if="sessionOf(hid)?.subTab === 'network'"
            :host="hid"
          />
          <DockerView
            v-if="sessionOf(hid)?.subTab === 'docker'"
            :host="hid"
          />
          <DatabasesView
            v-if="sessionOf(hid)?.subTab === 'databases'"
            :host="hid"
          />
          <FilesView
            v-if="sessionOf(hid)?.subTab === 'files'"
            :host="hid"
          />
          <DiskManageView
            v-if="sessionOf(hid)?.subTab === 'disks'"
            :host="hid"
          />
          <ServicesView
            v-if="sessionOf(hid)?.subTab === 'services'"
            :host="hid"
          />
          <CronView
            v-if="sessionOf(hid)?.subTab === 'cron'"
            :host="hid"
          />
          <PackagesView
            v-if="sessionOf(hid)?.subTab === 'packages'"
            :host="hid"
          />
          <LogsView
            v-if="sessionOf(hid)?.subTab === 'logs'"
            :host="hid"
          />
          <TerminalView
            v-if="sessionOf(hid)?.subTab === 'terminal'"
            :host="hid"
          />
          <JavaView
            v-if="sessionOf(hid)?.subTab === 'java'"
            :host="hid"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { useAppStore, type SubTab } from "@/stores/app";
import { ElMessage, ElMessageBox } from "element-plus";
import { api } from "@/api";
import { ref } from "vue";
import OverviewView from "@/views/OverviewView.vue";
import GroupOverviewView from "@/views/GroupOverviewView.vue";
import ProcessesView from "@/views/ProcessesView.vue";
import NetworkView from "@/views/NetworkView.vue";
import DockerView from "@/views/DockerView.vue";
import DatabasesView from "@/views/DatabasesView.vue";
import FilesView from "@/views/FilesView.vue";
import DiskManageView from "@/views/DiskManageView.vue";
import ServicesView from "@/views/ServicesView.vue";
import CronView from "@/views/CronView.vue";
import PackagesView from "@/views/PackagesView.vue";
import LogsView from "@/views/LogsView.vue";
import TerminalView from "@/views/TerminalView.vue";
import JavaView from "@/views/JavaView.vue";
import AllHostsOverviewView from "@/views/AllHostsOverviewView.vue";

const app = useAppStore();

const zshBusy = ref<string | null>(null);

function formatErr(e: unknown): string {
  return (e as { message?: string })?.message || String(e);
}

// 初始化 zsh 环境:上传内置脚本 → 切终端自动执行,实时看输出
async function onInitZsh(hid: string) {
  try {
    await ElMessageBox.confirm(
      `将在主机「${hid}」上安装 zsh + Oh My Zsh(ys 主题)+ 代码高亮/历史提示插件。\n` +
        `需要该用户具备 sudo 免密权限,耗时约 1~5 分钟,会在终端实时显示输出。`,
      "初始化 zsh 环境",
      { type: "warning", confirmButtonText: "开始", cancelButtonText: "取消" }
    );
  } catch {
    return; // 用户取消
  }
  zshBusy.value = hid;
  try {
    const remotePath = await api.bootstrapZsh(hid);
    // ; rm 保证脚本成功或失败都清理上传的临时脚本(呼应"临时文件要删")
    app.sendTerminalCmd(`bash ${remotePath}; rm -f ${remotePath}`);
    app.setSubTab(hid, "terminal");
    ElMessage.success("脚本已上传,正在终端执行…");
  } catch (e) {
    ElMessage.error(`上传脚本失败: ${formatErr(e)}`);
  } finally {
    zshBusy.value = null;
  }
}

const subTabs: { value: SubTab; label: string }[] = [
  { value: "overview", label: "概览" },
  { value: "processes", label: "进程" },
  { value: "network", label: "网络" },
  { value: "docker", label: "Docker" },
  { value: "databases", label: "数据库" },
  { value: "files", label: "文件" },
  { value: "disks", label: "磁盘" },
  { value: "services", label: "服务" },
  { value: "cron", label: "定时任务" },
  { value: "packages", label: "软件包" },
  { value: "logs", label: "日志" },
  { value: "terminal", label: "终端" },
  { value: "java", label: "Java" },
];

const FILL_SUBS: SubTab[] = [
  "terminal",
  "files",
  "processes",
  "network",
  "docker",
  "services",
  "cron",
  "packages",
  "java",
];

function sessionOf(hid: string) {
  return app.hostSessions[hid];
}

function isFillSub(sub?: SubTab) {
  return !!sub && FILL_SUBS.includes(sub);
}

function onSubChange(hid: string, v: string | number | boolean | undefined) {
  if (typeof v !== "string") return;
  // 确保当前激活的是这台主机（用户点的是可见 shell 的 tabs）
  if (app.activeTabId !== hid) app.openHostTab(hid);
  app.setSubTab(hid, v as SubTab);
}
</script>

<style scoped lang="scss">
.host-shell {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.host-header {
  height: 48px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  background: #fff;
  border-bottom: var(--panel-border, 1px solid #f2f2f2);
  .name {
    font-size: 14px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .sub {
    font-size: 11px;
    color: var(--el-text-color-secondary);
  }
  .host-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
}
.run-badge {
  font-size: 10px;
  font-weight: 500;
  color: #67c23a;
  background: rgba(103, 194, 58, 0.12);
  border: 1px solid rgba(103, 194, 58, 0.35);
  border-radius: 10px;
  padding: 0 6px;
  line-height: 16px;
}
html.dark .host-header {
  background: var(--panel-main-bg-color-9, #2e313d);
}
.router-tabs {
  flex-shrink: 0;
  padding: 10px 20px 10px;
  background: #fff;
  border-bottom: 1px solid var(--panel-border, #f2f2f2);
  :deep(.el-radio-button__inner) {
    padding: 10px 16px;
  }
  :deep(.el-radio-button.is-active .el-radio-button__inner) {
    background: #fff;
    color: var(--el-color-primary);
    border-color: var(--el-color-primary);
    box-shadow: none;
  }
}
html.dark .router-tabs {
  background: var(--panel-main-bg-color-9, #2e313d);
}
.content-pad {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 10px 20px 16px;
  box-sizing: border-box;

  &--fill {
    display: flex;
    flex-direction: column;
    padding: 0;
    overflow: hidden;
    /* 终端等全高视图：子组件必须能吃掉剩余高度 */
    > * {
      flex: 1 1 auto;
      min-height: 0;
      min-width: 0;
    }
  }
}
</style>
