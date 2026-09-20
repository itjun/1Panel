<template>
  <div class="session-body">
    <HostInfoView
      v-if="session && mountedInfo"
      v-show="session.tool === 'info'"
      :host="session.host"
    />
    <FilesView
      v-if="session && mountedFileManager"
      v-show="session.tool === 'file-manager'"
      :host="session.host"
    />
    <SftpSessionView
      v-if="session && mountedSftp"
      v-show="session.tool === 'sftp'"
      :host="session.host"
    />
    <HostMonitorPane
      v-if="session && mountedMonitor"
      v-show="session.tool === 'monitor'"
      :host="session.host"
    />
    <CertsView
      v-if="session && mountedCerts"
      v-show="session.tool === 'certs'"
      :host="session.host"
    />
    <NginxView
      v-if="session && mountedNginx"
      v-show="session.tool === 'nginx'"
      :host="session.host"
    />
    <ProcessesView
      v-if="session && mountedProcesses"
      v-show="session.tool === 'processes'"
      :host="session.host"
    />
    <NetworkView
      v-if="session && mountedNetwork"
      v-show="session.tool === 'network'"
      :host="session.host"
    />
    <HostsView
      v-if="session && mountedHosts"
      v-show="session.tool === 'hosts'"
      :host="session.host"
    />
    <AptView
      v-if="session && mountedApt"
      v-show="session.tool === 'apt'"
      :host="session.host"
    />
    <AppsView
      v-if="session && mountedApps"
      v-show="session.tool === 'apps'"
      :host="session.host"
    />
    <ServicesView
      v-if="session && mountedServices"
      v-show="session.tool === 'services'"
      :host="session.host"
    />
    <CronView
      v-if="session && mountedCron"
      v-show="session.tool === 'cron'"
      :host="session.host"
    />
    <LogsView
      v-if="session && mountedLogs"
      v-show="session.tool === 'logs'"
      :host="session.host"
    />
    <PackagesView
      v-if="session && mountedPackages"
      v-show="session.tool === 'packages'"
      :host="session.host"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useAppStore, type WorkspaceSession } from "@/stores/app";
import HostInfoView from "@/views/HostInfoView.vue";
import FilesView from "@/views/FilesView.vue";
import SftpSessionView from "@/views/SftpSessionView.vue";
import HostMonitorPane from "@/views/HostMonitorPane.vue";
import CertsView from "@/views/CertsView.vue";
import NginxView from "@/views/NginxView.vue";
import ProcessesView from "@/views/ProcessesView.vue";
import NetworkView from "@/views/NetworkView.vue";
import HostsView from "@/views/HostsView.vue";
import AptView from "@/views/AptView.vue";
import AppsView from "@/views/AppsView.vue";
import ServicesView from "@/views/ServicesView.vue";
import CronView from "@/views/CronView.vue";
import LogsView from "@/views/LogsView.vue";
import PackagesView from "@/views/PackagesView.vue";

const props = defineProps<{
  session: WorkspaceSession | null;
}>();

const app = useAppStore();

const mountedInfo = computed(() => {
  const host = props.session?.host;
  if (!host) return false;
  return (app.hostSessions[host]?.visited || []).includes("overview");
});
const mountedSftp = computed(() => {
  const host = props.session?.host;
  if (!host) return false;
  return (app.hostSessions[host]?.visited || []).includes("files");
});
const mountedFileManager = computed(() => {
  const host = props.session?.host;
  if (!host) return false;
  return (app.hostSessions[host]?.visited || []).includes("file-manager");
});
const mountedMonitor = computed(() => {
  const host = props.session?.host;
  if (!host) return false;
  return (app.hostSessions[host]?.visited || []).includes("monitor");
});
const mountedCerts = computed(() => {
  const host = props.session?.host;
  if (!host) return false;
  return (app.hostSessions[host]?.visited || []).includes("certs");
});
const mountedNginx = computed(() => {
  const host = props.session?.host;
  if (!host) return false;
  return (app.hostSessions[host]?.visited || []).includes("nginx");
});
const mountedProcesses = computed(() => {
  const host = props.session?.host;
  if (!host) return false;
  return (app.hostSessions[host]?.visited || []).includes("processes");
});
const mountedNetwork = computed(() => {
  const host = props.session?.host;
  if (!host) return false;
  return (app.hostSessions[host]?.visited || []).includes("network");
});
const mountedHosts = computed(() => {
  const host = props.session?.host;
  if (!host) return false;
  return (app.hostSessions[host]?.visited || []).includes("hosts");
});
const mountedApt = computed(() => {
  const host = props.session?.host;
  if (!host) return false;
  return (app.hostSessions[host]?.visited || []).includes("apt");
});
const mountedApps = computed(() => {
  const host = props.session?.host;
  if (!host) return false;
  return (app.hostSessions[host]?.visited || []).includes("apps");
});
const mountedServices = computed(() => {
  const host = props.session?.host;
  if (!host) return false;
  return (app.hostSessions[host]?.visited || []).includes("services");
});
const mountedCron = computed(() => {
  const host = props.session?.host;
  if (!host) return false;
  return (app.hostSessions[host]?.visited || []).includes("cron");
});
const mountedLogs = computed(() => {
  const host = props.session?.host;
  if (!host) return false;
  return (app.hostSessions[host]?.visited || []).includes("logs");
});
const mountedPackages = computed(() => {
  const host = props.session?.host;
  if (!host) return false;
  return (app.hostSessions[host]?.visited || []).includes("packages");
});
</script>

<style scoped lang="scss">
.session-body {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  > * {
    flex: 1;
    min-height: 0;
    min-width: 0;
  }
}
</style>
