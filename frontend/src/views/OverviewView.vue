<template>
  <div ref="pageRef" v-loading="loading && !overview" class="overview-page">
    <el-alert
      v-if="noSample && !overview"
      type="warning"
      title="Agent 已连通，尚无采样数据"
      show-icon
    >
      <template #default>
        <span>采集可能刚启动，或磁盘水位/写入异常。</span>
        <el-button
          link
          type="primary"
          style="margin-left: 8px"
          @click="agentInstall.openCheck(host)"
        >
          检查 Agent
        </el-button>
      </template>
    </el-alert>
    <el-alert
      v-else-if="error && !overview"
      type="error"
      :title="error"
      show-icon
    />
    <template v-if="overview">
      <el-row :gutter="12">
        <!-- 左栏 16 -->
        <el-col :xs="24" :md="16">
          <el-card
            shadow="never"
            class="home-card panel-hover-card"
            :class="{ 'is-enlarged': enlargedKey === 'overview' }"
            :style="enlargedKey === 'overview' ? enlargeStyle : undefined"
          >
            <div class="card-header" @dblclick="openEnlarge('overview')">
              <span class="panel-section-title">概览</span>
              <el-button
                link
                class="card-icon-btn card-toggle"
                :icon="enlargedKey === 'overview' ? Close : FullScreen"
                :title="enlargedKey === 'overview' ? '退出放大' : '放大'"
                @click="toggleEnlarge('overview')"
              />
            </div>
            <el-row :gutter="0" class="stats-grid">
              <el-col :span="6" v-for="s in stats" :key="s.label">
                <div class="stat-cell">
                  <div class="stat-label">{{ s.label }}</div>
                  <div class="stat-value">{{ s.value }}</div>
                </div>
              </el-col>
            </el-row>
          </el-card>

          <el-card
            shadow="never"
            class="home-card panel-hover-card card-interval"
            :class="{ 'is-enlarged': enlargedKey === 'status' }"
            :style="enlargedKey === 'status' ? enlargeStyle : undefined"
          >
            <div class="card-header" @dblclick="openEnlarge('status')">
              <span class="panel-section-title">状态</span>
              <el-button
                link
                class="card-icon-btn card-toggle"
                :icon="enlargedKey === 'status' ? Close : FullScreen"
                :title="enlargedKey === 'status' ? '退出放大' : '放大'"
                @click="toggleEnlarge('status')"
              />
            </div>
            <el-row :gutter="8">
              <el-col :span="6" align="center">
                <el-popover trigger="hover" placement="bottom" :width="200">
                  <div class="ring-popover" :class="{ 'is-danger': loadAlert }">
                    <div class="ring-pop-row">
                      <span>1 分钟</span>
                      <span class="num">{{ overview.load1.toFixed(2) }}</span>
                    </div>
                    <div class="ring-pop-row">
                      <span>5 分钟</span>
                      <span class="num">{{ overview.load5.toFixed(2) }}</span>
                    </div>
                    <div class="ring-pop-row">
                      <span>15 分钟</span>
                      <span class="num">{{ overview.load15.toFixed(2) }}</span>
                    </div>
                  </div>
                  <template #reference>
                    <VChartPie
                      height="160px"
                      :danger="loadAlert"
                      :option="{ title: '负载', data: loadPercent }"
                    />
                  </template>
                </el-popover>
                <div class="input-help">{{ loadLabel }}</div>
              </el-col>
              <el-col :span="6" align="center">
                <el-popover trigger="hover" placement="bottom" :width="280">
                  <div class="ring-popover" :class="{ 'is-danger': cpuAlert }">
                    <div class="ring-pop-row">
                      <span class="ring-pop-label">型号</span>
                      <span
                        class="ring-pop-value"
                        :title="overview.cpuModel"
                      >
                        {{ overview.cpuModel || '—' }}
                      </span>
                    </div>
                    <div class="ring-pop-row">
                      <span>核心数</span>
                      <span class="num">{{ overview.cpuCount }} 核</span>
                    </div>
                    <div class="ring-pop-row">
                      <span>使用率</span>
                      <span class="num">{{ overview.cpuPercent.toFixed(2) }}%</span>
                    </div>
                  </div>
                  <template #reference>
                    <VChartPie
                      height="160px"
                      :danger="cpuAlert"
                      :option="{ title: 'CPU', data: overview.cpuPercent }"
                    />
                  </template>
                </el-popover>
                <div class="input-help">
                  ( {{ overview.cpuPercent.toFixed(2) }} /
                  {{ overview.cpuCount }} ) 核
                </div>
              </el-col>
              <el-col :span="6" align="center">
                <el-popover trigger="hover" placement="bottom" :width="300">
                  <div class="ring-popover" :class="{ 'is-danger': memAlert }">
                    <div class="ring-pop-grid">
                      <div class="ring-pop-col">
                        <div class="ring-pop-title">内存</div>
                        <div class="ring-pop-row">
                          <span>总量</span>
                          <span class="num">{{ formatMemCapacity(overview.memTotal) }}</span>
                        </div>
                        <div class="ring-pop-row">
                          <span>已用</span>
                          <span class="num">{{ formatBytes(overview.memUsed) }}</span>
                        </div>
                        <div class="ring-pop-row">
                          <span>可用</span>
                          <span class="num">{{ formatBytes(overview.memTotal - overview.memUsed) }}</span>
                        </div>
                        <div class="ring-pop-row">
                          <span>使用率</span>
                          <span class="num">{{ overview.memPercent.toFixed(2) }}%</span>
                        </div>
                      </div>
                      <div v-if="overview.swapTotal > 0" class="ring-pop-col">
                        <div class="ring-pop-title">Swap</div>
                        <div class="ring-pop-row">
                          <span>总量</span>
                          <span class="num">{{ formatBytes(overview.swapTotal) }}</span>
                        </div>
                        <div class="ring-pop-row">
                          <span>已用</span>
                          <span class="num">{{ formatBytes(overview.swapUsed) }}</span>
                        </div>
                        <div class="ring-pop-row">
                          <span>可用</span>
                          <span class="num">{{ formatBytes(overview.swapTotal - overview.swapUsed) }}</span>
                        </div>
                        <div class="ring-pop-row">
                          <span>使用率</span>
                          <span class="num">{{ overview.swapPercent.toFixed(2) }}%</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <template #reference>
                    <VChartPie
                      height="160px"
                      :danger="memAlert"
                      :option="{ title: '内存', data: overview.memPercent }"
                    />
                  </template>
                </el-popover>
                <div class="input-help">
                  {{ formatBytes(overview.memUsed) }} /
                  {{ formatMemCapacity(overview.memTotal) }}
                </div>
              </el-col>
              <el-col :span="6" align="center">
                <el-popover trigger="hover" placement="bottom" :width="240">
                  <div class="ring-popover" :class="{ 'is-danger': diskLow }">
                    <div class="ring-pop-row">
                      <span>挂载点</span>
                      <span class="num">{{ rootDisk?.mount || '/' }}</span>
                    </div>
                    <div class="ring-pop-row">
                      <span>总量</span>
                      <span class="num">{{ formatBytes(rootDisk?.total || 0) }}</span>
                    </div>
                    <div class="ring-pop-row">
                      <span>已用</span>
                      <span class="num">{{ formatBytes(rootDisk?.used || 0) }}</span>
                    </div>
                    <div class="ring-pop-row">
                      <span>可用</span>
                      <span class="num">{{ formatBytes(rootDisk?.avail || 0) }}</span>
                    </div>
                    <div class="ring-pop-row">
                      <span>使用率</span>
                      <span class="num">{{ (rootDisk?.percent || 0).toFixed(2) }}%</span>
                    </div>
                  </div>
                  <template #reference>
                    <VChartPie
                      height="160px"
                      :danger="diskLow"
                      :option="{
                        title: rootDisk?.mount || '/',
                        data: rootDisk?.percent || 0,
                      }"
                    />
                  </template>
                </el-popover>
                <div
                  class="input-help"
                  :class="{ 'is-danger': diskLow }"
                  v-if="rootDisk"
                >
                  {{ formatBytes(rootDisk.used) }} /
                  {{ formatBytes(rootDisk.total) }}
                </div>
              </el-col>
            </el-row>
          </el-card>

          <el-card
            shadow="never"
            class="home-card panel-hover-card card-interval monitor-entry-card"
            @click="goMonitor"
          >
            <div class="card-header">
              <div class="card-title-group">
                <span class="panel-section-title">监控</span>
                <span class="monitor-entry-hint">
                  负载 / CPU / 内存 / 流量 / 磁盘 IO 曲线
                </span>
              </div>
              <el-button link class="card-icon-btn" :icon="ArrowRight" title="打开监控页" />
            </div>
          </el-card>

          <el-card
            shadow="never"
            class="home-card panel-hover-card card-interval"
            :class="{ 'is-enlarged': enlargedKey === 'disks' }"
            :style="enlargedKey === 'disks' ? enlargeStyle : undefined"
          >
            <div class="card-header" @dblclick="openEnlarge('disks')">
              <span class="panel-section-title">磁盘</span>
              <div class="card-actions">
                <el-button
                  link
                  class="card-icon-btn"
                  :icon="Refresh"
                  title="刷新"
                  @click="loadDisks"
                />
                <el-button
                  link
                  class="card-icon-btn card-toggle"
                  :icon="enlargedKey === 'disks' ? Close : FullScreen"
                  :title="enlargedKey === 'disks' ? '退出放大' : '放大'"
                  @click="toggleEnlarge('disks')"
                />
              </div>
            </div>
            <div v-if="!disks?.length" class="empty-tip">暂无磁盘数据</div>
            <div
              v-for="d in disks"
              :key="d.mount"
              class="disk-row disk-row--clickable"
              title="点击查看该分区的最大文件"
              @click="openLargestFiles(d)"
            >
              <span class="disk-mount">{{ d.mount }}</span>
              <el-progress
                :percentage="Math.min(100, d.percent)"
                :stroke-width="8"
                :status="d.percent > 90 ? 'exception' : undefined"
                style="flex: 1"
              />
              <span class="disk-size">
                {{ formatBytes(d.used) }} / {{ formatBytes(d.total) }}
              </span>
            </div>
          </el-card>
        </el-col>

        <!-- 右栏 8 -->
        <el-col :xs="24" :md="8">
          <el-card
            shadow="never"
            class="home-card panel-hover-card"
            :class="{ 'is-enlarged': enlargedKey === 'sysinfo' }"
            :style="enlargedKey === 'sysinfo' ? enlargeStyle : undefined"
          >
            <div class="card-header" @dblclick="openEnlarge('sysinfo')">
              <span class="panel-section-title">系统信息</span>
              <el-button
                link
                class="card-icon-btn card-toggle"
                :icon="enlargedKey === 'sysinfo' ? Close : FullScreen"
                :title="enlargedKey === 'sysinfo' ? '退出放大' : '放大'"
                @click="toggleEnlarge('sysinfo')"
              />
            </div>
            <div class="kv-list">
              <div class="kv-row">
                <span class="kv-label">主机名称</span>
                <span class="kv-value">{{ overview.hostname || host }}</span>
              </div>
              <div class="kv-row">
                <span class="kv-label">发行版本</span>
                <span class="kv-value">{{ overview.osRelease || "—" }}</span>
              </div>
              <div class="kv-row">
                <span class="kv-label">内核版本</span>
                <span class="kv-value">{{ overview.kernel || "—" }}</span>
              </div>
              <div class="kv-row">
                <span class="kv-label">系统类型</span>
                <span class="kv-value">{{ overview.arch || "—" }}</span>
              </div>
              <div class="kv-row">
                <span class="kv-label">主机地址</span>
                <span class="kv-value">{{ overview.ipAddress || "—" }}</span>
              </div>
              <div class="kv-row">
                <span class="kv-label">CPU 型号</span>
                <span class="kv-value" :title="overview.cpuModel || undefined">
                  {{ overview.cpuModel || "—" }}
                </span>
              </div>
              <div class="kv-row">
                <span class="kv-label">运行时间</span>
                <span class="kv-value">{{ formatDurationLong(overview.uptime) }}</span>
              </div>
            </div>
          </el-card>

          <el-card
            shadow="never"
            class="home-card panel-hover-card card-interval"
            :class="{ 'is-enlarged': enlargedKey === 'agent' }"
            :style="enlargedKey === 'agent' ? enlargeStyle : undefined"
          >
            <div class="card-header" @dblclick="openEnlarge('agent')">
              <span class="panel-section-title">Agent</span>
              <div class="card-actions">
                <el-dropdown v-if="agentInfo?.ok" trigger="click" @command="onAgentCommand">
                  <el-tag
                    :type="agentUpdatable ? 'warning' : 'success'"
                    effect="plain"
                    size="small"
                    class="agent-tag-btn"
                  >
                    {{ agentUpdatable ? "可更新" : "在线" }}
                  </el-tag>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item v-if="agentUpdatable" command="upgrade">
                        更新到 {{ latestAgentVersion }}
                      </el-dropdown-item>
                      <el-dropdown-item command="check">
                        检查 Agent
                      </el-dropdown-item>
                      <el-dropdown-item command="uninstall" divided>
                        卸载 Agent
                      </el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
                <el-tag
                  v-else
                  type="info"
                  effect="plain"
                  size="small"
                  class="agent-tag-btn"
                  title="未安装或未运行；点击检查"
                  @click="agentInstall.openCheck(host)"
                >
                  离线
                </el-tag>
                <el-button
                  link
                  class="card-icon-btn card-toggle"
                  :icon="enlargedKey === 'agent' ? Close : FullScreen"
                  :title="enlargedKey === 'agent' ? '退出放大' : '放大'"
                  @click="toggleEnlarge('agent')"
                />
              </div>
            </div>
            <div class="kv-list">
              <div class="kv-row">
                <span class="kv-label">当前版本</span>
                <span class="kv-value">
                  {{ agentInfo?.ok ? agentInfo.version || "—" : "—" }}
                </span>
              </div>
              <div class="kv-row">
                <span class="kv-label">面板内置</span>
                <span class="kv-value">{{ latestAgentVersion || "—" }}</span>
              </div>
              <div class="kv-row">
                <span class="kv-label">内存占用</span>
                <span class="kv-value">
                  {{
                    agentInfo?.ok && agentInfo.rssKB
                      ? formatBytes(agentInfo.rssKB * 1024)
                      : "—"
                  }}
                </span>
              </div>
            </div>
            <div v-if="!agentInfo?.ok" class="empty-tip agent-offline-hint">
              在侧栏右键主机可安装 Agent
            </div>
          </el-card>

          <el-card
            shadow="never"
            class="home-card panel-hover-card card-interval"
            :class="{ 'is-enlarged': enlargedKey === 'runtimes' }"
            :style="enlargedKey === 'runtimes' ? enlargeStyle : undefined"
          >
            <div class="card-header" @dblclick="openEnlarge('runtimes')">
              <span class="panel-section-title">运行环境</span>
              <div class="card-actions">
                <span class="hint">{{ installedRuntimes }} / {{ runtimes.length }} 已安装</span>
                <el-button
                  link
                  class="card-icon-btn"
                  :icon="Refresh"
                  title="刷新"
                  @click="loadRuntimes"
                />
                <el-button
                  link
                  class="card-icon-btn card-toggle"
                  :icon="enlargedKey === 'runtimes' ? Close : FullScreen"
                  :title="enlargedKey === 'runtimes' ? '退出放大' : '放大'"
                  @click="toggleEnlarge('runtimes')"
                />
              </div>
            </div>
            <div class="rt-list">
              <div v-for="r in runtimes" :key="r.name" class="rt-row">
                <img class="rt-logo" :src="runtimeLogo(r.name)" :alt="r.name" />
                <span class="rt-name">{{ r.name }}</span>
                <el-tag v-if="r.version" size="small" type="success" effect="light">
                  {{ r.version }}
                </el-tag>
                <template v-else>
                  <el-tag size="small" type="info" effect="plain">未安装</el-tag>
                  <el-button
                    link
                    type="primary"
                    size="small"
                    @click="confirmInstallRuntime(r.name)"
                  >
                    安装
                  </el-button>
                </template>
                <span class="rt-path" :title="r.detail || r.path">{{ r.path || "—" }}</span>
              </div>
            </div>
          </el-card>
        </el-col>
      </el-row>
    </template>

    <div
      v-if="enlargedKey"
      class="enlarge-mask"
      :style="enlargeStyle"
      @click="closeEnlarge"
    />

    <!-- 点击磁盘行：查看该分区的最大文件（按大小倒序） -->
    <LargestFilesDialog
      v-model="largestFilesOpen"
      :host="props.host"
      :mount="largestFilesMount"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ArrowRight, Close, CopyDocument, FullScreen, Refresh } from "@element-plus/icons-vue";
import { ElButton, ElMessage, ElMessageBox, ElNotification } from "element-plus";
import { api } from "@/api";
import type { agentcli, monitor } from "@/api";
import { formatErr, isAgentMissing, isAgentNoSample } from "@/utils/format";
import LargestFilesDialog from "@/components/LargestFilesDialog.vue";
import { useAppStore } from "@/stores/app";
import { useAgentInstallStore } from "@/stores/agentInstall";
import { copyText } from "@/utils/clipboard";
import {
  formatBytes,
  formatDurationLong,
  formatMemCapacity,
} from "@/utils/format";
import {
  ALERT,
  diskLowMessage,
  isCpuAlert,
  isDiskLow,
  isLoadAlert,
  isMemAlert,
  pickRootDisk,
} from "@/utils/alerts";
import {
  clearHostWecom,
  fireHostWecom,
  hostWecomKindFromKey,
  shouldToastHostAlert,
} from "@/utils/wecomHostAlerts";
import VChartPie from "@/components/VChartPie.vue";
import javaLogo from "@/assets/runtime/java-original.svg";
import goLogo from "@/assets/runtime/go-original.svg";
import nodeLogo from "@/assets/runtime/nodejs-original.svg";
import pythonLogo from "@/assets/runtime/python-original.svg";
import bunLogo from "@/assets/runtime/bun-original.svg";

const props = defineProps<{ host: string }>();
const app = useAppStore();
const agentInstall = useAgentInstallStore();

const loading = ref(false);
const error = ref<string | null>(null);
const overview = ref<monitor.Overview | null>(null);
const disks = ref<monitor.DiskInfo[]>([]);
const docker = ref<monitor.DockerInfo | null>(null);

/** 运行环境识别：java / go / python / node / bun */
const runtimes = ref<monitor.RuntimeInfo[]>([]);
const installedRuntimes = computed(
  () => runtimes.value.filter((r) => r.version).length
);

/** 运行环境 Logo（devicon 彩色版） */
const RUNTIME_LOGOS: Record<string, string> = {
  java: javaLogo,
  go: goLogo,
  node: nodeLogo,
  python: pythonLogo,
  python3: pythonLogo,
  bun: bunLogo,
};

function runtimeLogo(name: string): string {
  if (RUNTIME_LOGOS[name]) {
    return RUNTIME_LOGOS[name];
  }
  if (name.startsWith("python")) {
    return pythonLogo;
  }
  return "";
}

async function loadRuntimes() {
  try {
    runtimes.value = (await api.collectRuntimes(props.host)) || [];
  } catch {
    runtimes.value = [];
  }
}

/**
 * 未安装环境的一键安装命令（Ubuntu + root）
 * Go / Node 安装时动态查询官方接口取最新版本，不固定版本号
 */
const INSTALL_COMMANDS: Record<string, string> = {
  java: "apt update && apt install -y openjdk-21-jdk && java -version",
  python:
    "apt update && apt install -y python3 python3-pip python3-venv && ln -sf /usr/bin/python3 /usr/bin/python && python --version",
  go: "ARCH=$(uname -m); case $ARCH in x86_64) A=amd64;; aarch64|arm64) A=arm64;; *) A=''; echo \"不支持的架构: $ARCH\";; esac; [ -n \"$A\" ] && V=$( (curl -fsSL --connect-timeout 8 'https://go.dev/dl/?mode=json' || curl -fsSL 'https://golang.google.cn/dl/?mode=json') | python3 -c 'import json,sys;print(json.load(sys.stdin)[0][\"version\"])' 2>/dev/null) && echo \"安装 Go $V ...\" && (curl -fL --connect-timeout 8 \"https://go.dev/dl/${V}.linux-${A}.tar.gz\" -o /tmp/go.tgz || curl -fL \"https://mirrors.aliyun.com/golang/${V}.linux-${A}.tar.gz\" -o /tmp/go.tgz) && rm -rf /usr/local/go && tar -C /usr/local -xzf /tmp/go.tgz && rm /tmp/go.tgz && printf 'export PATH=$PATH:/usr/local/go/bin\\n' > /etc/profile.d/go.sh && export PATH=$PATH:/usr/local/go/bin && go version",
  node: "ARCH=$(uname -m); case $ARCH in x86_64) A=x64;; aarch64|arm64) A=arm64;; *) A=''; echo \"不支持的架构: $ARCH\";; esac; [ -n \"$A\" ] && V=$( (curl -fsSL --connect-timeout 8 'https://nodejs.org/dist/index.json' || curl -fsSL 'https://npmmirror.com/mirrors/node/index.json') | python3 -c 'import json,sys;print([e[\"version\"] for e in json.load(sys.stdin) if e[\"lts\"]][0])' 2>/dev/null) && echo \"安装 Node $V (LTS) ...\" && (curl -fL --connect-timeout 8 \"https://nodejs.org/dist/${V}/node-${V}-linux-${A}.tar.xz\" -o /tmp/node.tar.xz || curl -fL \"https://npmmirror.com/mirrors/node/${V}/node-${V}-linux-${A}.tar.xz\" -o /tmp/node.tar.xz) && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 && rm /tmp/node.tar.xz && node --version && npm --version",
  bun: "apt update && apt install -y unzip curl ca-certificates && ARCH=$(uname -m); case $ARCH in x86_64) T=linux-x64;; aarch64|arm64) T=linux-aarch64;; *) T=''; echo \"不支持的架构: $ARCH\";; esac; [ -n \"$T\" ] && { [ \"$T\" = linux-x64 ] && ! grep -q avx2 /proc/cpuinfo 2>/dev/null && T=linux-x64-baseline; true; } && V=$(curl -fsSL --connect-timeout 8 'https://registry.npmmirror.com/-/binary/bun/' | python3 -c 'import json,sys,re; ns=[x[\"name\"].rstrip(\"/\") for x in json.load(sys.stdin) if re.match(r\"^bun-v\\d\", x[\"name\"])]; print(sorted(ns, key=lambda n:[int(x) for x in n[5:].split(\".\")])[-1])') && echo \"安装 Bun $V ($T) → /usr/local ...\" && mkdir -p /usr/local/bin && (curl -fL --connect-timeout 20 \"https://registry.npmmirror.com/-/binary/bun/${V}/bun-${T}.zip\" -o /tmp/bun.zip || curl -fL --connect-timeout 20 \"https://ghfast.top/https://github.com/oven-sh/bun/releases/download/${V}/bun-${T}.zip\" -o /tmp/bun.zip || curl -fL \"https://github.com/oven-sh/bun/releases/download/${V}/bun-${T}.zip\" -o /tmp/bun.zip) && rm -rf /tmp/bun-extract && unzip -oqd /tmp/bun-extract /tmp/bun.zip && mv \"/tmp/bun-extract/bun-${T}/bun\" /usr/local/bin/bun && chmod +x /usr/local/bin/bun && rm -rf /tmp/bun.zip /tmp/bun-extract && bun --version",
};

/** 确认后切到终端自动执行安装命令 */
async function confirmInstallRuntime(name: string) {
  const cmd = INSTALL_COMMANDS[name];
  if (!cmd) return;

  async function copyInstallCmd(e?: Event) {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    try {
      await copyText(cmd);
      ElMessage.success("已复制安装命令");
    } catch {
      ElMessage.error("复制失败");
    }
  }

  try {
    await ElMessageBox.confirm(
      h("div", { class: "install-runtime-msg" }, [
        h("p", { class: "install-runtime-hint" }, [
          "将在终端执行以下命令安装 ",
          h("b", null, name),
          "（需 root）：",
        ]),
        h("div", { class: "install-runtime-cmd-wrap" }, [
          h(
            "code",
            {
              class: "install-runtime-cmd",
              title: cmd,
            },
            cmd
          ),
          h(
            ElButton,
            {
              class: "install-runtime-copy",
              size: "small",
              onClick: (e: MouseEvent) => {
                void copyInstallCmd(e);
              },
            },
            {
              default: () => [
                h(CopyDocument, { class: "install-runtime-copy-icon" }),
                " 复制",
              ],
            }
          ),
        ]),
      ]),
      `安装 ${name}`,
      {
        confirmButtonText: "安装",
        cancelButtonText: "取消",
        type: "warning",
        customClass: "install-runtime-box",
        distinguishCancelAndClose: true,
      }
    );
  } catch {
    return; // 用户取消
  }
  await app.runInTerminal(cmd);
}

/** agent 状态徽章（在线版本 / 离线提示；安装入口在主机右键菜单） */
const agentInfo = ref<agentcli.Status | null>(null);
/** 面板内置 agent 版本（比对显示「可更新」） */
const latestAgentVersion = ref("");

async function loadAgentStatus() {
  try {
    agentInfo.value = await api.agentStatus(props.host);
  } catch {
    agentInfo.value = null;
  }
  try {
    latestAgentVersion.value = await api.agentLatestVersion();
  } catch {
    latestAgentVersion.value = "";
  }
}

// ---------- 打开主机时的 agent 检测（弹窗询问安装，绝不自动安装） ----------
/** 本会话内已检测/提示过的主机，避免切换主机反复弹通知 */
const agentCheckedHosts = new Set<string>();

/** 弹窗询问是否安装；确认后走进度对话框，取消则静默 */
async function askInstallAgent(host: string) {
  try {
    await ElMessageBox.confirm(
      `将向 ${host} 部署 spanel-agent（systemd 服务，约 10MB）。已安装时更新到面板内置版本，历史数据保留。`,
      "安装 Agent",
      { confirmButtonText: "安装", cancelButtonText: "取消" }
    );
  } catch {
    return;
  }
  await agentInstall.start(host);
}

async function checkAgentInstalled() {
  const host = props.host;
  if (agentCheckedHosts.has(host)) return;
  agentCheckedHosts.add(host);

  let status: agentcli.Status | null = null;
  try {
    status = await api.agentStatus(host, true);
  } catch {
    status = null;
  }
  if (status?.ok) return;
  if (status?.notInstalled) {
    await askInstallAgent(host);
    return;
  }

  // agent 不在线且状态未标未装：SSH 探测区分「未安装」与「已装未运行」
  try {
    const info = await api.agentProbeInfo(host);
    if (!info.HasBinary) {
      await askInstallAgent(host);
      return;
    }
    if (info.ServiceState !== "active") {
      ElNotification.warning({
        title: "spanel-agent 未运行",
        message: `${host} 的 spanel-agent 服务状态为 ${info.ServiceState}，监控数据暂不可用。可在目标机执行 systemctl restart spanel-agent 恢复。`,
        duration: 8000,
      });
    }
  } catch {
    // SSH 也不通时连接错误已有其它展示，这里不再叠加提示
  }
}

/** agent 在线且版本低于面板内置 → 可更新 */
const agentUpdatable = computed(
  () =>
    !!agentInfo.value?.ok &&
    !!latestAgentVersion.value &&
    agentInfo.value.version !== latestAgentVersion.value
);

/** 更新 / 卸载（安装也可从打开主机时的询问弹窗或侧栏右键触发，install 与 upgrade 走同一幂等接口） */
const agentBusy = ref(false);
async function onAgentCommand(cmd: string) {
  if (agentBusy.value) return;
  const host = props.host;
  if (cmd === "check") {
    agentInstall.openCheck(host);
    return;
  }
  if (cmd === "upgrade") {
    const version = latestAgentVersion.value;
    try {
      await ElMessageBox.confirm(
        `将向 ${host} 部署 spanel-agent（systemd 服务，约 10MB）。更新时历史数据保留。`,
        "更新 Agent",
        { confirmButtonText: `更新到 ${version}`, cancelButtonText: "取消" }
      );
    } catch {
      return;
    }
    agentBusy.value = true;
    try {
      // 进度对话框内展示各阶段步骤与失败详情
      const ok = await agentInstall.start(host);
      if (ok) await loadAgentStatus();
    } finally {
      agentBusy.value = false;
    }
    return;
  }
  if (cmd === "uninstall") {
    let keep = true;
    try {
      await ElMessageBox.confirm(
        "卸载后该主机将无法采集监控历史。是否保留已落库的数据（重装后可继续查看）？",
        "卸载 Agent",
        {
          confirmButtonText: "卸载并保留数据",
          cancelButtonText: "卸载并删除数据",
          distinguishCancelAndClose: true,
        }
      );
    } catch (action) {
      if (action === "close") return;
      keep = false;
    }
    agentBusy.value = true;
    try {
      await api.uninstallAgent(host, keep);
      await loadAgentStatus();
    } catch (e) {
      ElMessageBox.alert(formatErr(e), { type: "error" }).catch(() => {});
    } finally {
      agentBusy.value = false;
    }
  }
}

/** 监控入口卡：跳转监控一级子页 */
function goMonitor() {
  if (app.activeTabId) {
    app.setSubTab(app.activeTabId, "monitor");
  }
}

// 监控卡片已迁移到独立的 MonitorView 一级子页；此处仅保留流量差分（状态环用）
let timer: number | undefined;
let slowTimer: number | undefined;

// 终端正在使用时暂停本机的 3s 采集轮询：隐藏状态下每 3s 的响应解析
// 与 vdom patch 会占用 WebView 主线程，直接造成终端输入/回显卡顿
// （图表重绘虽已被 useChartVisibility 挡住，采集开销仍在）。
// 离开终端后 watch 会立即补一次刷新，常热数据不受影响。
const terminalActive = computed(() => {
  const t = app.activeTab;
  if (t?.kind !== "host") return false;
  return app.hostSessions[t.id]?.subTab === "terminal";
});

const rootDisk = computed(() => pickRootDisk(disks.value));
const diskLow = computed(() => isDiskLow(disks.value));
const cpuAlert = computed(() => isCpuAlert(overview.value));
const memAlert = computed(() => isMemAlert(overview.value));
const loadAlert = computed(() => isLoadAlert(overview.value));
const agentMissing = computed(
  () => isAgentMissing(error.value) || !!agentInfo.value?.notInstalled
);
const noSample = computed(() => isAgentNoSample(error.value));

const alertLines = computed(() => {
  if (agentMissing.value || noSample.value) return [] as { key: string; line: string }[];
  const host = props.host;
  if (error.value) {
    return [
      {
        key: "conn",
        line: `「${host}」连接失败：${error.value}`,
      },
    ];
  }
  const ov = overview.value;
  if (!ov) return [] as { key: string; line: string }[];
  const out: { key: string; line: string }[] = [];
  if (cpuAlert.value) {
    out.push({
      key: "cpu",
      line: `「${host}」CPU ${ov.cpuPercent.toFixed(1)}% ≥ ${ALERT.cpu}%`,
    });
  }
  if (memAlert.value) {
    out.push({
      key: "mem",
      line: `「${host}」内存 ${ov.memPercent.toFixed(1)}% 超过 ${ALERT.mem}%`,
    });
  }
  if (diskLow.value) {
    out.push({ key: "disk", line: diskLowMessage(host, disks.value) });
  }
  if (loadAlert.value) {
    out.push({
      key: "load",
      line: `「${host}」负载 ${ov.load1.toFixed(2)} / ${ov.cpuCount} 核 超过警戒`,
    });
  }
  return out;
});

let prevAlertKeys = new Set<string>();
watch(
  alertLines,
  (lines) => {
    const next = new Set(lines.map((l) => l.key));
    const newLines = lines
      .filter((l) => {
        if (prevAlertKeys.has(l.key)) return false;
        const kind = hostWecomKindFromKey(l.key);
        return shouldToastHostAlert(props.host, kind);
      })
      .map((l) => l.line);
    for (const l of lines) {
      if (prevAlertKeys.has(l.key)) continue;
      const kind = hostWecomKindFromKey(l.key);
      if (kind) {
        void fireHostWecom({
          key: `${props.host}|${l.key}`,
          host: props.host,
          kind,
          detail: l.line,
        });
      }
    }
    for (const key of prevAlertKeys) {
      if (next.has(key)) continue;
      const kind = hostWecomKindFromKey(key);
      if (kind) {
        void clearHostWecom({
          key: `${props.host}|${key}`,
          host: props.host,
          kind,
        });
      }
    }
    prevAlertKeys = next;
    if (!newLines.length) return;
    ElNotification({
      type: "error",
      title: newLines.length === 1 ? "主机告警" : `主机告警（${newLines.length} 项）`,
      message: newLines.join("\n"),
      duration: 10000,
      position: "top-right",
      showClose: true,
    });
  },
  { deep: true }
);

const loadPercent = computed(() => {
  if (!overview.value?.cpuCount) return 0;
  return Math.min(
    100,
    (overview.value.load1 / overview.value.cpuCount) * 100
  );
});

const loadLabel = computed(() => {
  const v = loadPercent.value;
  if (v < 30) return "运行流畅";
  if (v < 70) return "运行正常";
  if (v < 80) return "运行缓慢";
  return "运行堵塞";
});

const stats = computed(() => [
  { label: "CPU 核心", value: String(overview.value?.cpuCount ?? 0) },
  { label: "磁盘分区", value: String(disks.value?.length ?? 0) },
  {
    label: "Docker 容器",
    value: String(docker.value?.containers?.length ?? 0),
  },
  {
    label: "运行中容器",
    value: String(
      (docker.value?.containers || []).filter(
        (c) => (c.state || "").toLowerCase() === "running"
      ).length
    ),
  },
]);

async function loadOverview() {
  try {
    const data = await api.collectOverview(props.host);
    overview.value = data;
    error.value = null;
    if (data.osRelease) {
      app.rememberOsRelease(props.host, data.osRelease);
    }
  } catch (e) {
    error.value = formatErr(e);
  }
}

async function loadDisks() {
  try {
    disks.value = (await api.collectDisks(props.host)) || [];
  } catch {
    disks.value = [];
  }
}

/** 点击磁盘行：弹出该分区最大文件列表 */
const largestFilesOpen = ref(false);
const largestFilesMount = ref("");
function openLargestFiles(d: monitor.DiskInfo) {
  largestFilesMount.value = d.mount || d.filesystem || "/";
  largestFilesOpen.value = true;
}

async function loadDocker() {
  try {
    docker.value = await api.collectDocker(props.host);
  } catch {
    docker.value = null;
  }
}

async function refreshAll() {
  loading.value = true;
  await Promise.all([
    loadOverview(),
    loadDisks(),
    loadDocker(),
    loadRuntimes(),
    loadAgentStatus(),
  ]);
  loading.value = false;
}

function resetHostState() {
  overview.value = null;
  disks.value = [];
  docker.value = null;
  runtimes.value = [];
  agentInfo.value = null;
}

// ---------- 卡片放大（全窗口覆盖置顶，盖住侧栏/标签栏） ----------
const pageRef = ref<HTMLElement | null>(null);
const enlargedKey = ref<string | null>(null);

const enlargeStyle = computed(() => ({
  top: 0,
  left: 0,
  width: "100vw",
  height: "100vh",
}));

function openEnlarge(key: string) {
  enlargedKey.value = key;
  // 最大化期间隐藏 macOS 红绿灯；图表 resize 由 ResizeObserver 自动处理
  api.setTrafficLightsHidden(true).catch(() => {});
}

function closeEnlarge() {
  enlargedKey.value = null;
  api.setTrafficLightsHidden(false).catch(() => {});
}

function toggleEnlarge(key: string) {
  if (enlargedKey.value === key) closeEnlarge();
  else openEnlarge(key);
}

function onEnlargeKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && enlargedKey.value) closeEnlarge();
}

watch(
  () => props.host,
  () => {
    resetHostState();
    enlargedKey.value = null;
    void refreshAll();
    void checkAgentInstalled();
  }
);

watch(
  () => agentInstall.lastInstalled,
  (info) => {
    if (info?.host === props.host) {
      error.value = null;
      void loadAgentStatus();
      void refreshAll();
    }
  }
);

// 终端占用结束后立即补刷：概览快数据 + 运行环境（装完 java/bun 等切回来应马上看到）
watch(terminalActive, (active) => {
  if (!active) {
    void loadOverview();
    void loadRuntimes();
    void loadDisks();
    void loadDocker();
  }
});

onMounted(() => {
  resetHostState();
  void refreshAll();
  void checkAgentInstalled();
  timer = window.setInterval(() => {
    if (terminalActive.value || agentMissing.value) return;
    void loadOverview();
  }, 2000);
  slowTimer = window.setInterval(() => {
    if (agentMissing.value) return;
    void loadDisks();
    void loadDocker();
    void loadRuntimes();
    void loadAgentStatus();
  }, 10000);
  window.addEventListener("keydown", onEnlargeKeydown);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  if (slowTimer) clearInterval(slowTimer);
  window.removeEventListener("keydown", onEnlargeKeydown);
});
</script>

<style scoped lang="scss">
/* 滚动交给外层 .content-pad；本页不设 height:100% + overflow:auto，避免双滚动条 */
.overview-page {
  min-width: 0;
  max-width: 100%;
  overflow: visible;
  padding: 0 0 16px;
  box-sizing: border-box;

  /* el-row gutter 用负 margin，会顶破父级宽度 → 横向滚动条 */
  :deep(> .el-row) {
    max-width: 100%;
    box-sizing: border-box;
  }
  :deep(.el-col) {
    min-width: 0;
    max-width: 100%;
  }
}

/* 监控入口卡：点击跳转监控一级子页 */
.monitor-entry-card {
  cursor: pointer;
}
.monitor-entry-hint {
  color: var(--m3-on-surface-variant, #49454f);
  font-size: 13px;
}
.agent-tag-btn {
  cursor: pointer;
}
.agent-offline-hint {
  padding: 10px 0 0;
}

.home-card {
  max-width: 100%;
  overflow: hidden;
  box-sizing: border-box;

  /* M3 Outlined Card：12dp 圆角已由全局 el-card；内边距 16dp；标题 title-medium */
  :deep(.el-card__body) {
    padding: 16px;
    max-width: 100%;
    box-sizing: border-box;
    background: transparent;
  }

  .panel-section-title {
    font: var(--m3-title-medium);
    font-weight: 500;
    line-height: 24px;
  }
}
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  min-height: 32px;
}
/* 放大态：卡片提升铺满主内容区，内部列表撑满滚动 */
.home-card.is-enlarged {
  position: fixed;
  z-index: 2500;
  max-width: none;
  overflow: hidden;
  border-radius: 0;
  box-shadow: none;
  :deep(.el-card__body) {
    height: 100%;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
  }
}
.enlarge-mask {
  position: fixed;
  z-index: 2000;
  background: color-mix(in srgb, var(--m3-scrim, #000) 50%, transparent);
}
.card-title-group {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  row-gap: 4px;
}
.card-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
/* 卡片头右侧图标按钮：on-surface-variant，悬停 on-surface */
.card-icon-btn {
  width: 40px;
  height: 40px;
  color: var(--m3-on-surface-variant);
  border-radius: var(--m3-shape-full);
  transition: background-color var(--m3-motion-state), color var(--m3-motion-state);

  &:hover {
    color: var(--m3-on-surface);
    background: color-mix(in srgb, var(--m3-on-surface) 8%, transparent);
  }
}
/* 放大状态下的关闭按钮：红色醒目 */
.home-card.is-enlarged .card-toggle {
  color: var(--m3-error);
}
/* 概览指标：浅蓝 tonal 格（primary-container），无描边嵌套 */
.stats-grid {
  :deep(.el-col) {
    padding-left: 6px;
    padding-right: 6px;

    &:first-child {
      padding-left: 0;
    }
    &:last-child {
      padding-right: 0;
    }
  }
}
.stat-cell {
  text-align: center;
  padding: 12px 8px;
  border: none;
  border-radius: var(--m3-shape-s);
  background: var(--m3-primary-container);
  transition: background-color var(--m3-motion-state);

  &:hover {
    background: color-mix(in srgb, var(--m3-primary) 8%, var(--m3-primary-container));
  }
}
.stat-label {
  font: var(--m3-label-medium);
  color: var(--m3-on-primary-container);
}
.stat-value {
  margin-top: 6px;
  font: var(--m3-headline-small);
  font-weight: 500;
  color: var(--m3-on-primary-container);
}
.input-help {
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
  margin-top: 4px;

  &.is-danger {
    color: var(--m3-error);
  }
}
.disk-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  font: var(--m3-body-small);
  color: var(--m3-on-surface);
}
.disk-row--clickable {
  cursor: pointer;
  padding: 6px 8px;
  border-radius: var(--m3-shape-xs);
  transition: background-color var(--m3-motion-state);
  &:hover {
    background: color-mix(in srgb, var(--m3-on-surface) 8%, transparent);
  }
}
.disk-mount {
  width: 72px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
.disk-size {
  width: 140px;
  text-align: right;
  color: var(--m3-on-surface-variant);
  flex-shrink: 0;
}
.empty-tip {
  text-align: center;
  color: var(--m3-on-surface-variant);
  font: var(--m3-body-medium);
  padding: 20px 0;
}
/* 运行环境卡片：M3 list + outline-variant 分隔 */
.rt-list {
  display: flex;
  flex-direction: column;
}
.rt-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 36px;
  padding: 4px 0;
  border-bottom: 1px solid var(--m3-outline-variant);
  &:last-of-type {
    border-bottom: none;
  }
}
.rt-logo {
  flex-shrink: 0;
  width: 34px;
  height: 24px;
  object-fit: contain;
}
.rt-name {
  flex-shrink: 0;
  width: 52px;
  font: var(--m3-label-large);
  font-weight: 500;
  color: var(--m3-on-surface);
}
.rt-path {
  flex: 1;
  min-width: 0;
  font: var(--m3-body-small);
  font-family: var(--m3-font-mono);
  color: var(--m3-on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hint {
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
}
/* 系统信息 / Agent：与运行环境同款 list 行，固定标签列宽对齐值列 */
.kv-list {
  display: flex;
  flex-direction: column;
}
.kv-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 32px;
  padding: 4px 0;
  border-bottom: 1px solid var(--m3-outline-variant);
  &:last-of-type {
    border-bottom: none;
  }
}
.kv-label {
  flex-shrink: 0;
  width: 5.5em;
  font: var(--m3-body-medium);
  color: var(--m3-on-surface-variant);
  white-space: nowrap;
}
.kv-value {
  flex: 1;
  min-width: 0;
  font: var(--m3-body-medium);
  color: var(--m3-on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

<!-- el-popover / MessageBox 内容 teleport 到 body，scoped 样式无法穿透，故用全局样式 -->
<style lang="scss">
.el-overlay-message-box .el-message-box.install-runtime-box {
  width: min(520px, calc(100% - 32px)) !important;
}

.install-runtime-msg {
  text-align: left;
  min-width: 0;
}

.install-runtime-hint {
  margin: 0 0 8px;
  line-height: 1.45;
  color: var(--m3-on-surface);
}

.install-runtime-cmd-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 6px 8px 6px 10px;
  border: 1px solid var(--m3-outline-variant);
  border-radius: var(--m3-shape-s);
  background: var(--m3-surface-container);
}

.install-runtime-cmd {
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--m3-body-small);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  line-height: 1.4;
  color: var(--m3-on-surface);
  background: transparent;
}

.install-runtime-copy {
  flex-shrink: 0;
}

.install-runtime-copy-icon {
  width: 14px;
  height: 14px;
  margin-right: 2px;
  vertical-align: -2px;
}

.ring-popover {
  font: var(--m3-body-small);
  color: var(--m3-on-surface);

  .ring-pop-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 4px 0;

    .num {
      font-weight: 600;
      color: var(--m3-primary);
      white-space: nowrap;
    }
  }

  &.is-danger .num {
    color: var(--m3-error);
  }

  .ring-pop-label {
    flex-shrink: 0;
    color: var(--m3-on-surface-variant);
  }
  .ring-pop-value {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
  }

  .ring-pop-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 0 20px;
  }
  .ring-pop-title {
    font: var(--m3-title-small);
    font-weight: 600;
    color: var(--m3-primary);
    padding: 4px 0;
    margin-bottom: 2px;
    border-bottom: 1px solid var(--m3-outline-variant);
  }
}
</style>
