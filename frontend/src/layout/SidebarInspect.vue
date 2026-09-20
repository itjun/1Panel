<template>
  <SidebarMenu
    title="巡检"
    :items="menuItems"
    :active-id="activeId"
    @select="onSelect"
  />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useAppStore, type InspectSection } from "@/stores/app";
import SidebarMenu, { type SidebarMenuItem } from "@/layout/SidebarMenu.vue";

const app = useAppStore();

const menuItems: SidebarMenuItem[] = [
  { id: "menuCheck", label: "菜单检查" },
];

const activeId = computed(() =>
  app.settingsOpen ? "__settings__" : app.inspectSection
);

function onSelect(id: string) {
  app.setInspectSection(id as InspectSection);
}
</script>
