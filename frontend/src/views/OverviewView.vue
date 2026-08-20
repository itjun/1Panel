<template>
  <div ref="pageRef" v-loading="loading && !overview" class="overview-page">
    <el-alert v-if="error && !overview" type="error" :title="error" show-icon />
    <template v-if="overview">
      <el-row :gutter="7">
        <!-- 左栏 16 -->
        <el-col :xs="24" :md="16">
          <el-card
            shadow="never"
            class="home-card"
            :class="{ 'is-enlarged': enlargedKey === 'overview' }"
            :style="enlargedKey === 'overview' ? enlargeStyle : undefined"
          >
            <div class="card-header" @dblclick="openEnlarge('overview')">
              <span class="panel-section-title">概览</span>
              <div class="card-actions">
                <el-button
                  link
                  class="card-icon-btn"
                  :icon="Refresh"
                  title="刷新"
                  @click="refreshAll"
                />
                <el-button
                  link
                  class="card-icon-btn card-toggle"
                  :icon="enlargedKey === 'overview' ? Close : FullScreen"
                  :title="enlargedKey === 'overview' ? '退出放大' : '放大'"
                  @click="toggleEnlarge('overview')"
                />
              </div>
            </div>
            <el-row :gutter="12">
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
            class="home-card card-interval"
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
                  <div class="ring-popover">
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
                      :option="{ title: '负载', data: loadPercent }"
                    />
                  </template>
                </el-popover>
                <div class="input-help">{{ loadLabel }}</div>
              </el-col>
              <el-col :span="6" align="center">
                <el-popover trigger="hover" placement="bottom" :width="280">
                  <div class="ring-popover">
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
                  <div class="ring-popover">
                    <div class="ring-pop-grid">
                      <div class="ring-pop-col">
                        <div class="ring-pop-title">内存</div>
                        <div class="ring-pop-row">
                          <span>总量</span>
                          <span class="num">{{ formatBytes(overview.memTotal) }}</span>
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
                      :option="{ title: '内存', data: overview.memPercent }"
                    />
                  </template>
                </el-popover>
                <div class="input-help">
                  {{ formatBytes(overview.memUsed) }} /
                  {{ formatBytes(overview.memTotal) }}
                </div>
              </el-col>
              <el-col :span="6" align="center">
                <el-popover trigger="hover" placement="bottom" :width="240">
                  <div class="ring-popover">
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
                      :option="{
                        title: rootDisk?.mount || '/',
                        data: rootDisk?.percent || 0,
                      }"
                    />
                  </template>
                </el-popover>
                <div class="input-help" v-if="rootDisk">
                  {{ formatBytes(rootDisk.used) }} /
                  {{ formatBytes(rootDisk.total) }}
                </div>
              </el-col>
            </el-row>
          </el-card>

          <el-card
            shadow="never"
            class="home-card card-interval"
            :class="{ 'is-enlarged': enlargedKey === 'monitor' }"
            :style="enlargedKey === 'monitor' ? enlargeStyle : undefined"
          >
            <div class="card-header" @dblclick="openEnlarge('monitor')">
              <div class="card-title-group">
                <span class="panel-section-title">监控</span>
                <el-radio-group v-model="chartMode" size="small">
                  <el-radio-button value="network">流量</el-radio-button>
                  <el-radio-button value="io">磁盘 IO</el-radio-button>
                </el-radio-group>
                <el-radio-group v-model="rangeMode" size="small" class="range-group">
                  <el-radio-button value="live">实时</el-radio-button>
                  <el-radio-button value="1h">1时</el-radio-button>
                  <el-radio-button value="6h">6时</el-radio-button>
                  <el-radio-button value="24h">24时</el-radio-button>
                  <el-radio-button value="7d">7天</el-radio-button>
                </el-radio-group>
                <el-dropdown v-if="agentInfo?.ok" trigger="click" @command="onAgentCommand">
                  <el-tag
                    :type="agentUpdatable ? 'warning' : 'success'"
                    effect="plain"
                    size="small"
                    class="agent-tag agent-tag-btn"
                  >
                    {{ agentUpdatable ? `Agent ${agentInfo.version}（可更新）` : `Agent ${agentInfo.version}` }}
                  </el-tag>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item v-if="agentUpdatable" command="upgrade">
                        更新到 {{ latestAgentVersion }}
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
                  class="agent-tag agent-tag-btn"
                  title="点击安装 spanel-agent"
                  @click="onAgentCommand('install')"
                >
                  安装 Agent
                </el-tag>
              </div>
              <el-button
                link
                class="card-icon-btn card-toggle"
                :icon="enlargedKey === 'monitor' ? Close : FullScreen"
                :title="enlargedKey === 'monitor' ? '退出放大' : '放大'"
                @click="toggleEnlarge('monitor')"
              />
            </div>
            <div v-if="chartMode === 'network'" class="monitor-tags">
              <template v-if="rangeMode === 'live'">
                <el-tag type="primary" effect="light">
                  上行: {{ formatBytes(rates.upBps) }}/s
                </el-tag>
                <el-tag type="primary" effect="light">
                  下行: {{ formatBytes(rates.downBps) }}/s
                </el-tag>
              </template>
            </div>
            <div v-else class="monitor-tags">
              <template v-if="rangeMode === 'live'">
                <el-tag type="primary" effect="light">
                  读: {{ formatBytes(ioRates.readBps) }}/s
                </el-tag>
                <el-tag type="primary" effect="light">
                  写: {{ formatBytes(ioRates.writeBps) }}/s
                </el-tag>
                <el-tag type="warning" effect="light">
                  IOPS: {{ ioRates.iops }}/s
                </el-tag>
              </template>
            </div>
            <div
              v-if="rangeMode !== 'live' && !historyLoading && !history.length"
              class="history-empty"
            >
              该区间暂无数据（agent 需运行一段时间，或未安装）
            </div>
            <VChartLine
              v-else
              height="280px"
              :option="chartMode === 'network' ? lineOption : ioLineOption"
            />
          </el-card>

          <el-card
            shadow="never"
            class="home-card card-interval"
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
            class="home-card"
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
            <el-descriptions :column="1" border size="small" class="sys-desc">
              <el-descriptions-item label="主机名称">
                {{ overview.hostname || host }}
              </el-descriptions-item>
              <el-descriptions-item label="发行版本">
                {{ overview.osRelease || "—" }}
              </el-descriptions-item>
              <el-descriptions-item label="内核版本">
                {{ overview.kernel || "—" }}
              </el-descriptions-item>
              <el-descriptions-item label="系统类型">
                {{ overview.arch || "—" }}
              </el-descriptions-item>
              <el-descriptions-item label="主机地址">
                {{ overview.ipAddress || "—" }}
              </el-descriptions-item>
              <el-descriptions-item label="CPU 型号">
                {{ overview.cpuModel || "—" }}
              </el-descriptions-item>
              <el-descriptions-item label="运行时间">
                {{ formatDurationLong(overview.uptime) }}
              </el-descriptions-item>
            </el-descriptions>
          </el-card>

          <el-card
            shadow="never"
            class="home-card card-interval"
            :class="{ 'is-enlarged': enlargedKey === 'runtimes' }"
            :style="enlargedKey === 'runtimes' ? enlargeStyle : undefined"
          >
            <div class="card-header" @dblclick="openEnlarge('runtimes')">
              <span class="panel-section-title">运行环境</span>
              <div class="card-actions">
                <span class="hint">{{ installedRuntimes }} / {{ runtimes.length }} 已安装</span>
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

          <!-- 应用：先 Java，再 Docker -->
          <el-card
            shadow="never"
            class="home-card card-interval"
            :class="{ 'is-enlarged': enlargedKey === 'java' }"
            :style="enlargedKey === 'java' ? enlargeStyle : undefined"
          >
            <div class="card-header" @dblclick="openEnlarge('java')">
              <span class="panel-section-title">应用</span>
              <div class="card-actions">
                <span class="hint">Java · {{ javaList.length }}</span>
                <el-button
                  link
                  class="card-icon-btn card-toggle"
                  :icon="enlargedKey === 'java' ? Close : FullScreen"
                  :title="enlargedKey === 'java' ? '退出放大' : '放大'"
                  @click="toggleEnlarge('java')"
                />
              </div>
            </div>
            <div class="app-scroll">
              <div v-if="appsLoading" class="empty-tip">加载中…</div>
              <div v-else-if="!javaList.length" class="empty-tip">暂无 Java 进程</div>
              <div
                v-for="p in javaList"
                :key="'j-' + p.pid"
                class="app-row"
              >
                <div class="app-meta">
                  <div class="app-name" :title="p.cmd">
                    {{ javaAppTitle(p.cmd) }}
                  </div>
                  <div class="app-img">
                    PID {{ p.pid }} · CPU {{ (p.cpu || 0).toFixed(1) }}% ·
                    {{ formatBytes(Number(p.rss) || 0) }}
                  </div>
                </div>
                <el-tag size="small" type="warning">Java</el-tag>
              </div>
            </div>
          </el-card>

          <el-card
            shadow="never"
            class="home-card card-interval"
            :class="{ 'is-enlarged': enlargedKey === 'docker' }"
            :style="enlargedKey === 'docker' ? enlargeStyle : undefined"
          >
            <div class="card-header" @dblclick="openEnlarge('docker')">
              <span class="panel-section-title">应用</span>
              <div class="card-actions">
                <span class="hint">
                  Docker ·
                  {{ docker?.available ? dockerList.length : "—" }}
                </span>
                <el-button
                  link
                  class="card-icon-btn card-toggle"
                  :icon="enlargedKey === 'docker' ? Close : FullScreen"
                  :title="enlargedKey === 'docker' ? '退出放大' : '放大'"
                  @click="toggleEnlarge('docker')"
                />
              </div>
            </div>
            <div class="app-scroll">
              <div v-if="appsLoading" class="empty-tip">加载中…</div>
              <div v-else-if="!docker?.available" class="empty-tip">
                未检测到 Docker
              </div>
              <div v-else-if="!dockerList.length" class="empty-tip">
                暂无容器
              </div>
              <div
                v-for="c in dockerList"
                :key="c.id || c.name"
                class="app-row"
              >
                <div class="app-meta">
                  <div class="app-name">{{ c.name || c.id }}</div>
                  <div class="app-img">{{ c.image || c.status }}</div>
                </div>
                <el-tag
                  size="small"
                  :type="
                    (c.state || '').toLowerCase() === 'running'
                      ? 'success'
                      : 'info'
                  "
                >
                  {{ c.state || "—" }}
                </el-tag>
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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Close, FullScreen, Refresh } from "@element-plus/icons-vue";
import { ElMessageBox, ElNotification } from "element-plus";
import { api } from "@/api";
import type { agentcli, monitor } from "@/api";
import { formatErr } from "@/utils/format";
import LargestFilesDialog from "@/components/LargestFilesDialog.vue";
import { useAppStore } from "@/stores/app";
import {
  bytesToKBps,
  formatBytes,
  formatDurationLong,
} from "@/utils/format";
import VChartPie from "@/components/VChartPie.vue";
import VChartLine from "@/components/VChartLine.vue";
import javaLogo from "@/assets/runtime/java-original.svg";
import goLogo from "@/assets/runtime/go-original.svg";
import nodeLogo from "@/assets/runtime/nodejs-original.svg";
import pythonLogo from "@/assets/runtime/python-original.svg";
import bunLogo from "@/assets/runtime/bun-original.svg";

const props = defineProps<{ host: string }>();
const app = useAppStore();

const loading = ref(false);
const error = ref<string | null>(null);
const overview = ref<monitor.Overview | null>(null);
const disks = ref<monitor.DiskInfo[]>([]);
const docker = ref<monitor.DockerInfo | null>(null);
const javaList = ref<monitor.ProcInfo[]>([]);
const appsLoading = ref(false);

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
  node: "ARCH=$(uname -m); case $ARCH in x86_64) A=amd64;; aarch64|arm64) A=arm64;; *) A=''; echo \"不支持的架构: $ARCH\";; esac; [ -n \"$A\" ] && V=$( (curl -fsSL --connect-timeout 8 'https://nodejs.org/dist/index.json' || curl -fsSL 'https://npmmirror.com/mirrors/node/index.json') | python3 -c 'import json,sys;print([e[\"version\"] for e in json.load(sys.stdin) if e[\"lts\"]][0])' 2>/dev/null) && echo \"安装 Node $V (LTS) ...\" && (curl -fL --connect-timeout 8 \"https://nodejs.org/dist/${V}/node-${V}-linux-${A}.tar.xz\" -o /tmp/node.tar.xz || curl -fL \"https://npmmirror.com/mirrors/node/${V}/node-${V}-linux-${A}.tar.xz\" -o /tmp/node.tar.xz) && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 && rm /tmp/node.tar.xz && node --version && npm --version",
  bun: "curl -fsSL https://bun.sh/install | bash && export PATH=\"$HOME/.bun/bin:$PATH\" && bun --version",
};

/** 确认后切到终端自动执行安装命令 */
async function confirmInstallRuntime(name: string) {
  const cmd = INSTALL_COMMANDS[name];
  if (!cmd) return;
  try {
    await ElMessageBox.confirm(
      `将在终端真实执行以下命令安装 <b>${name}</b>（需 root 权限）：<pre>${cmd}</pre>`,
      `安装 ${name}`,
      {
        confirmButtonText: "安装",
        cancelButtonText: "取消",
        type: "warning",
        dangerouslyUseHTMLString: true,
        customStyle: { maxWidth: "640px" },
      }
    );
  } catch {
    return; // 用户取消
  }
  app.sendTerminalCmd(cmd);
  if (app.activeTabId) {
    app.setSubTab(app.activeTabId, "terminal");
  }
}

const dockerList = computed(
  () => (docker.value?.containers || []) as monitor.Container[]
);

const traffic = ref<{ time: string; up: number; down: number }[]>([]);
const rates = ref({ upBps: 0, downBps: 0 });
const lastNet = ref<{ rx: number; tx: number; ts: number } | null>(null);

// ---------- Agent 历史曲线（数据来自目标主机 SQLite，离线期间也不缺） ----------
/** agent 状态徽章（在线版本 / 不可达） */
const agentInfo = ref<agentcli.Status | null>(null);
/** 面板内置 agent 版本（比对显示「可更新」） */
const latestAgentVersion = ref("");
/** 历史区间：live=实时（前端差分），其余为 agent 落库历史 */
const rangeMode = ref<"live" | "1h" | "6h" | "24h" | "7d">("live");
const RANGE_SPAN: Record<string, number> = {
  "1h": 3600,
  "6h": 6 * 3600,
  "24h": 24 * 3600,
  "7d": 7 * 86400,
};
const history = ref<agentcli.RangePoint[]>([]);
const historyLoading = ref(false);

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

// ---------- 打开主机时的 agent 安装检测（只提示，绝不自动安装） ----------
/** 本会话内已检测/提示过的主机，避免切换主机反复弹通知 */
const agentCheckedHosts = new Set<string>();

async function checkAgentInstalled() {
  const host = props.host;
  if (agentCheckedHosts.has(host)) return;
  agentCheckedHosts.add(host);

  let online = false;
  try {
    online = (await api.agentStatus(host, true))?.ok === true;
  } catch {
    online = false;
  }
  if (online) return;

  // agent 不在线：SSH 探测精确区分「未安装」与「已安装未运行」（一次性管理操作）
  try {
    const info = await api.agentProbeInfo(host);
    if (!info.HasBinary) {
      ElNotification.info({
        title: "未安装 spanel-agent",
        message: `${host} 尚未安装 spanel-agent，监控数据不可用。如需使用，请点击监控卡片右上角的「安装 Agent」手动安装（不会自动安装）。`,
        duration: 8000,
      });
    } else if (info.ServiceState !== "active") {
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

/** 安装 / 更新 / 卸载（install 与 upgrade 走同一幂等接口） */
const agentBusy = ref(false);
async function onAgentCommand(cmd: string) {
  if (agentBusy.value) return;
  const host = props.host;
  if (cmd === "install" || cmd === "upgrade") {
    const action = cmd === "install" ? "安装" : `更新到 v${latestAgentVersion.value}`;
    try {
      await ElMessageBox.confirm(
        `将向 ${host} 部署 spanel-agent（systemd 服务，约 10MB）。更新时历史数据保留。`,
        `${action} Agent`,
        { confirmButtonText: action, cancelButtonText: "取消" }
      );
    } catch {
      return;
    }
    agentBusy.value = true;
    try {
      await api.installAgent(host);
      await loadAgentStatus();
      ElMessageBox.alert(`${action}完成`, { type: "success" }).catch(() => {});
    } catch (e) {
      ElMessageBox.alert(formatErr(e), { type: "error" }).catch(() => {});
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

async function loadHistory() {
  const span = RANGE_SPAN[rangeMode.value];
  if (!span) return;
  historyLoading.value = true;
  try {
    const to = Math.floor(Date.now() / 1000);
    const r = await api.agentRange(props.host, to - span, to, "auto");
    history.value = r.points || [];
  } catch {
    history.value = [];
  } finally {
    historyLoading.value = false;
  }
}

watch(rangeMode, () => void loadHistory());

/** 历史点的横轴标签：24h 内显示 HH:mm，更长显示 MM-dd HH:mm */
function historyTimeLabel(ts: number): string {
  const d = new Date(ts * 1000);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (rangeMode.value === "7d") {
    return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${hh}:${mm}`;
  }
  return `${hh}:${mm}`;
}

// 监控卡片：流量 / 磁盘 IO 切换
const chartMode = ref<"network" | "io">("network");
const ioTraffic = ref<{ time: string; read: number; write: number }[]>([]);
const ioRates = ref({ readBps: 0, writeBps: 0, iops: 0 });
const lastDisk = ref<{ read: number; write: number; count: number; ts: number } | null>(null);

let timer: number | undefined;
let historyTimer: number | undefined;

// 终端正在使用时暂停后台轮询：本组件对所有已打开主机都保活挂载（v-show），
// 隐藏状态下每 3s 的 SSH 采集 + ECharts 重绘会占用 WebView 主线程，
// 直接造成终端输入/回显卡顿。离开终端后 watch 会立即补一次刷新。
const terminalActive = computed(() => {
  const t = app.activeTab;
  if (t?.kind !== "host") return false;
  return app.hostSessions[t.id]?.subTab === "terminal";
});

const rootDisk = computed(() => {
  if (!disks.value?.length) return null;
  return (
    disks.value.find((d) => d.mount === "/") ||
    [...disks.value].sort((a, b) => b.total - a.total)[0]
  );
});

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

const lineOption = computed(() => {
  // 历史模式：直接用 agent 预计算的速率（KB/s）
  if (rangeMode.value !== "live") {
    return {
      xData: history.value.map((p) => historyTimeLabel(p.ts)),
      yData: [
        { name: "上行", data: history.value.map((p) => p.netTxKBps) },
        { name: "下行", data: history.value.map((p) => p.netRxKBps) },
      ],
      formatStr: "KB/s",
    };
  }
  return {
    xData: traffic.value.map((t) => t.time),
    yData: [
      { name: "上行", data: traffic.value.map((t) => t.up) },
      { name: "下行", data: traffic.value.map((t) => t.down) },
    ],
    formatStr: "KB/s",
  };
});

const ioLineOption = computed(() => {
  if (rangeMode.value !== "live") {
    return {
      xData: history.value.map((p) => historyTimeLabel(p.ts)),
      yData: [
        { name: "读", data: history.value.map((p) => p.diskReadKBps) },
        { name: "写", data: history.value.map((p) => p.diskWriteKBps) },
      ],
      formatStr: "KB/s",
    };
  }
  return {
    xData: ioTraffic.value.map((t) => t.time),
    yData: [
      { name: "读", data: ioTraffic.value.map((t) => t.read) },
      { name: "写", data: ioTraffic.value.map((t) => t.write) },
    ],
    formatStr: "KB/s",
  };
});

async function loadOverview() {
  try {
    const data = await api.collectOverview(props.host);
    overview.value = data;
    error.value = null;
    if (data.osRelease) {
      app.rememberOsRelease(props.host, data.osRelease);
    }
    pushTraffic(data);
    pushDiskIO(data);
  } catch (e) {
    error.value = formatErr(e);
  }
}

function pushTraffic(data: monitor.Overview) {
  const now = Date.now();
  const rx = Number(data.netRxBytes) || 0;
  const tx = Number(data.netTxBytes) || 0;
  const prev = lastNet.value;
  lastNet.value = { rx, tx, ts: now };
  if (!prev || now <= prev.ts || rx < prev.rx || tx < prev.tx) return;
  const dt = now - prev.ts;
  const up = bytesToKBps(tx - prev.tx, dt);
  const down = bytesToKBps(rx - prev.rx, dt);
  rates.value = {
    upBps: ((tx - prev.tx) / dt) * 1000,
    downBps: ((rx - prev.rx) / dt) * 1000,
  };
  const time = new Date(now).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  traffic.value = [...traffic.value, { time, up, down }].slice(-100);
}

// 磁盘 IO 速率：对累计值做差分，和网络流量同模式
function pushDiskIO(data: monitor.Overview) {
  const now = Date.now();
  const read = Number(data.diskReadBytes) || 0;
  const write = Number(data.diskWriteBytes) || 0;
  const count = Number(data.diskIOCount) || 0;
  const prev = lastDisk.value;
  lastDisk.value = { read, write, count, ts: now };
  if (!prev || now <= prev.ts || read < prev.read || write < prev.write) return;
  const dt = now - prev.ts;
  const readKBps = bytesToKBps(read - prev.read, dt);
  const writeKBps = bytesToKBps(write - prev.write, dt);
  ioRates.value = {
    readBps: ((read - prev.read) / dt) * 1000,
    writeBps: ((write - prev.write) / dt) * 1000,
    iops: Math.round(((count - prev.count) / dt) * 1000),
  };
  const time = new Date(now).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  ioTraffic.value = [...ioTraffic.value, { time, read: readKBps, write: writeKBps }].slice(-100);
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

async function loadApps() {
  appsLoading.value = true;
  try {
    const [dj, dd] = await Promise.all([
      api.collectJava(props.host).catch(() => [] as monitor.ProcInfo[]),
      api.collectDocker(props.host).catch(() => null),
    ]);
    javaList.value = (dj || []) as monitor.ProcInfo[];
    docker.value = dd as monitor.DockerInfo | null;
  } finally {
    appsLoading.value = false;
  }
}

/** 从 java 命令行提取可读标题：优先 -jar 包名，其次疑似主类 */
function javaAppTitle(cmd: string): string {
  if (!cmd) return "java";
  const jar = cmd.match(/-jar\s+(\S+\.jar)/i);
  if (jar?.[1]) {
    const base = jar[1].split(/[/\\]/).pop() || jar[1];
    return base;
  }
  // 常见主类：com.xxx.Main / org.springframework.boot.loader...
  const tokens = cmd.split(/\s+/);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    if (/^[a-zA-Z_][\w.]*\.[A-Z][\w$]*$/.test(t) && !t.includes("/")) {
      return t;
    }
  }
  // 截断过长命令行
  return cmd.length > 48 ? cmd.slice(0, 46) + "…" : cmd;
}

async function refreshAll() {
  loading.value = true;
  await Promise.all([loadOverview(), loadDisks(), loadApps(), loadRuntimes()]);
  loading.value = false;
}

function resetHostState() {
  overview.value = null;
  disks.value = [];
  docker.value = null;
  javaList.value = [];
  runtimes.value = [];
  traffic.value = [];
  rates.value = { upBps: 0, downBps: 0 };
  lastNet.value = null;
  ioTraffic.value = [];
  ioRates.value = { readBps: 0, writeBps: 0, iops: 0 };
  lastDisk.value = null;
  agentInfo.value = null;
  history.value = [];
  rangeMode.value = "live";
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
  // 最大化期间隐藏 macOS 红绿灯
  api.setTrafficLightsHidden(true).catch(() => {});
  // 容器尺寸变化后通知 ECharts resize
  nextTick(() => window.dispatchEvent(new Event("resize")));
}

function closeEnlarge() {
  enlargedKey.value = null;
  api.setTrafficLightsHidden(false).catch(() => {});
  nextTick(() => window.dispatchEvent(new Event("resize")));
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
  async () => {
    resetHostState();
    enlargedKey.value = null;
    loading.value = true;
    await refreshAll();
    loading.value = false;
    void checkAgentInstalled();
  }
);

// 终端占用结束后立即补一次刷新，避免切回概览时数据陈旧
watch(terminalActive, (active) => {
  if (!active) void loadOverview();
});

onMounted(async () => {
  resetHostState();
  loading.value = true;
  await refreshAll();
  loading.value = false;
  void loadAgentStatus();
  void checkAgentInstalled();
  timer = window.setInterval(() => {
    if (terminalActive.value) return;
    void loadOverview();
  }, 3000);
  // 历史模式低频刷新（落库数据 5s/5min 一档，60s 足够）
  historyTimer = window.setInterval(() => {
    if (rangeMode.value !== "live") void loadHistory();
  }, 60000);
  window.addEventListener("keydown", onEnlargeKeydown);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  if (historyTimer) clearInterval(historyTimer);
  window.removeEventListener("keydown", onEnlargeKeydown);
});
</script>

<style scoped lang="scss">
/* 滚动交给外层 .content-pad；本页不设 height:100% + overflow:auto，避免双滚动条 */
.overview-page {
  min-width: 0;
  max-width: 100%;
  overflow: visible;
  padding: 0 0 12px;
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

/* 监控卡片：时间范围选择与 agent 徽章 */
.range-group {
  margin-left: 8px;
}
.agent-tag {
  margin-left: 8px;
}
.agent-tag-btn {
  cursor: pointer;
}
.history-empty {
  height: 280px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.home-card {
  border: 1px solid var(--el-border-color-light, #e4e7ed) !important;
  border-radius: 4px;
  max-width: 100%;
  overflow: hidden; /* 卡片内图表/描述表不得撑破横向 */
  box-sizing: border-box;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  /* 1Panel：悬停主色描边 */
  &:hover {
    border-color: var(--el-color-primary) !important;
    box-shadow: 0 0 0 1px var(--el-color-primary);
  }
  :deep(.el-card__body) {
    padding: 14px 16px;
    max-width: 100%;
    box-sizing: border-box;
  }
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
  .app-scroll {
    max-height: none;
    flex: 1 1 auto;
    min-height: 0;
  }
}
.enlarge-mask {
  position: fixed;
  z-index: 2000;
  background: rgba(0, 0, 0, 0.5);
}
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.card-title-group {
  display: flex;
  align-items: center;
  gap: 12px;
}
.card-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
/* 卡片头右侧图标按钮：灰色纯图标，悬停变主色（对齐 1Panel） */
.card-icon-btn {
  color: var(--el-text-color-secondary);
  &:hover {
    color: var(--el-color-primary);
  }
}
/* 放大状态下的关闭按钮：红色醒目 */
.home-card.is-enlarged .card-toggle {
  color: var(--el-color-danger);
}
.stat-cell {
  text-align: center;
  padding: 12px 8px;
  border: 1px solid var(--el-border-color-lighter, #ebeef5);
  border-radius: 4px;
  background: rgba(0, 94, 235, 0.03);
}
.stat-label {
  font-size: 12px;
  color: var(--el-text-color-regular);
}
.stat-value {
  margin-top: 6px;
  font-size: 18px;
  font-weight: 500;
  color: var(--el-color-primary);
}
.input-help {
  font-size: 12px;
  color: #646a73;
  margin-top: 2px;
}
.disk-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  font-size: 12px;
}
.disk-row--clickable {
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  &:hover {
    background: var(--el-fill-color-light);
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
  color: var(--el-text-color-regular);
  flex-shrink: 0;
}
.empty-tip {
  text-align: center;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  padding: 20px 0;
}
.app-scroll {
  max-height: 300px;
  overflow-y: auto;
}
/* 运行环境卡片 */
.rt-list {
  display: flex;
  flex-direction: column;
}
.rt-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 0;
  border-bottom: 1px solid var(--el-border-color-extra-light, #f2f6fc);
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
  font-size: 13px;
  font-weight: 500;
}
.rt-path {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.app-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--el-border-color-extra-light, #f2f6fc);
  &:last-of-type {
    border-bottom: none;
  }
}
.app-meta {
  flex: 1;
  min-width: 0;
}
.app-name {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.app-more {
  margin-top: 6px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  text-align: center;
}
.app-img {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hint {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
.sys-desc {
  :deep(.el-descriptions__label) {
    width: 88px;
  }
}
</style>

<!-- el-popover 内容 teleport 到 body，scoped 样式无法穿透，故用全局样式 -->
<style lang="scss">
.ring-popover {
  font-size: 12px;
  color: var(--el-text-color-primary);

  .ring-pop-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 3px 0;

    .num {
      font-weight: 600;
      color: var(--el-color-primary);
      white-space: nowrap;
    }
  }

  /* CPU 型号行：标签固定宽，值截断 */
  .ring-pop-label {
    flex-shrink: 0;
    color: var(--el-text-color-secondary);
  }
  .ring-pop-value {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
  }

  /* 内存两列网格 */
  .ring-pop-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 0 20px;
  }
  .ring-pop-title {
    font-weight: 600;
    color: var(--el-color-primary);
    padding: 3px 0;
    margin-bottom: 2px;
    border-bottom: 1px solid var(--el-border-color-lighter);
  }
}
</style>
