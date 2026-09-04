<template>
  <div ref="pageRef" v-loading="loading && !overview" class="overview-page">
    <el-alert v-if="error && !overview" type="error" :title="error" show-icon />
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
            class="home-card panel-hover-card card-interval"
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
                <el-tag class="metric-tag" effect="plain">
                  上行: {{ formatBytes(rates.upBps) }}/s
                </el-tag>
                <el-tag class="metric-tag" effect="plain">
                  下行: {{ formatBytes(rates.downBps) }}/s
                </el-tag>
              </template>
            </div>
            <div v-else class="monitor-tags">
              <template v-if="rangeMode === 'live'">
                <el-tag class="metric-tag" effect="plain">
                  读: {{ formatBytes(ioRates.readBps) }}/s
                </el-tag>
                <el-tag class="metric-tag" effect="plain">
                  写: {{ formatBytes(ioRates.writeBps) }}/s
                </el-tag>
                <el-tag class="metric-tag metric-tag--warn" effect="plain">
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
                      <el-dropdown-item command="uninstall" :divided="agentUpdatable">
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
                  title="未安装或未运行；在侧栏右键主机可安装 / 更新 Agent"
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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Close, FullScreen, Refresh } from "@element-plus/icons-vue";
import { ElMessageBox, ElNotification } from "element-plus";
import { api } from "@/api";
import type { agentcli, monitor } from "@/api";
import { formatErr, isAgentMissing } from "@/utils/format";
import LargestFilesDialog from "@/components/LargestFilesDialog.vue";
import { useAppStore } from "@/stores/app";
import { useAgentInstallStore } from "@/stores/agentInstall";
import {
  bytesToKBps,
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
} from "@/utils/wecomHostAlerts";
import VChartPie from "@/components/VChartPie.vue";
import VChartLine from "@/components/VChartLine.vue";
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

const traffic = ref<{ time: string; up: number; down: number }[]>([]);
const rates = ref({ upBps: 0, downBps: 0 });
const lastNet = ref<{ rx: number; tx: number; ts: number } | null>(null);

// ---------- Agent 历史曲线（数据来自目标主机 SQLite，离线期间也不缺） ----------
/** agent 状态徽章（在线版本 / 离线提示；安装入口在主机右键菜单） */
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

// ---------- 打开主机时的 agent 运行检测（只提示，绝不自动安装） ----------
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

  // agent 不在线时 SSH 探测：已安装但未运行才提示（带恢复命令）；
  // 未安装不弹通知——卡片右上角的「Agent 离线」标签已可见，
  // 安装入口在侧栏主机右键菜单
  try {
    const info = await api.agentProbeInfo(host);
    if (info.HasBinary && info.ServiceState !== "active") {
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

/** 更新 / 卸载（安装的入口在侧栏主机右键菜单，install 与 upgrade 走同一幂等接口） */
const agentBusy = ref(false);
async function onAgentCommand(cmd: string) {
  if (agentBusy.value) return;
  const host = props.host;
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

/** 首开曲线预取：agent SQLite 里现成有 5s 粒度的历史速率点，
 * 直接灌入 live 曲线作为初始数据——打开页面即呈现最近 15 分钟曲线，
 * 而不是从 1 个点开始逐秒积累。失败静默（退回逐点积累）。 */
async function seedLiveCurves() {
  if (traffic.value.length > 1) return; // 实时轮询已积累，无需预取
  try {
    const to = Math.floor(Date.now() / 1000);
    const r = await api.agentRange(props.host, to - 15 * 60, to, "auto");
    const pts = r.points || [];
    if (!pts.length || traffic.value.length > 1) return;
    // 只取最近 100 点：与 pushTraffic 的滑动窗口一致，
    // 避免首次 push 时 slice(-100) 把曲线突然裁掉一段
    const win = pts.slice(-100);
    traffic.value = win.map((p) => ({
      time: liveTimeLabel(p.ts * 1000),
      up: p.netTxKBps,
      down: p.netRxKBps,
    }));
    ioTraffic.value = win.map((p) => ({
      time: liveTimeLabel(p.ts * 1000),
      read: p.diskReadKBps,
      write: p.diskWriteKBps,
    }));
  } catch {
    /* agent 不可达或无历史：live 曲线退回逐点积累 */
  }
}

/** live 曲线点的横轴标签（HH:mm:ss；首开预取与逐秒积累的点同格式） */
function liveTimeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

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

const alertLines = computed(() => {
  if (agentMissing.value) return [] as { key: string; line: string }[];
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
      .filter((l) => !prevAlertKeys.has(l.key))
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
  traffic.value = [...traffic.value, { time: liveTimeLabel(now), up, down }].slice(-100);
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
  ioTraffic.value = [
    ...ioTraffic.value,
    { time: liveTimeLabel(now), read: readKBps, write: writeKBps },
  ].slice(-100);
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
    void seedLiveCurves();
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

// 终端占用结束后立即补一次刷新，避免切回概览时数据陈旧
watch(terminalActive, (active) => {
  if (!active) void loadOverview();
});

onMounted(() => {
  resetHostState();
  void refreshAll();
  void seedLiveCurves();
  void checkAgentInstalled();
  timer = window.setInterval(() => {
    if (terminalActive.value || agentMissing.value) return;
    void loadOverview();
  }, 2000);
  historyTimer = window.setInterval(() => {
    if (rangeMode.value !== "live") void loadHistory();
  }, 30000);
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
  if (historyTimer) clearInterval(historyTimer);
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

/* 监控卡片：时间范围选择 */
.range-group {
  margin-left: 8px;
}
.agent-tag-btn {
  cursor: pointer;
}
.agent-offline-hint {
  padding: 10px 0 0;
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

<!-- el-popover 内容 teleport 到 body，scoped 样式无法穿透，故用全局样式 -->
<style lang="scss">
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
