<template>
  <SidebarMenu
    title="本机"
    :items="menuItems"
    :active-id="activeId"
    @select="onSelect"
  />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useAppStore, type LocalSection } from "@/stores/app";
import SidebarMenu, { type SidebarMenuItem } from "@/layout/SidebarMenu.vue";

const app = useAppStore();

const menuItems: SidebarMenuItem[] = [
  { id: "overview", label: "系统概览" },
  { id: "procs", label: "应用进程" },
  { id: "packages", label: "软件列表" },
  { id: "storage", label: "磁盘空间" },
  { id: "network", label: "网络信息" },
  { id: "nginx", label: "Nginx" },
  { id: "hosts", label: "Hosts" },
  { id: "sysinfo", label: "关于本机" },
];

const activeId = computed(() =>
  app.settingsOpen ? "__settings__" : app.localSection
);

function onSelect(id: string) {
  app.setLocalSection(id as LocalSection);
}
</script>
