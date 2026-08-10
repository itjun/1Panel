import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { api } from "@/api";
import type { groups, sshconfig } from "@/api";

export const UNGROUPED_ID = "__ungrouped__";

export type SubTab =
  | "overview"
  | "processes"
  | "docker"
  | "files"
  | "services"
  | "cron"
  | "packages"
  | "terminal";

/** 当前主区展示的对象（无多标签栏） */
export interface ActiveView {
  id: string;
  title: string;
  subtitle?: string;
  kind: "host" | "group";
  subTab: SubTab;
}

export interface GroupNode {
  group: groups.Group | null;
  hosts: sshconfig.HostConfig[];
}

export const useAppStore = defineStore("app", () => {
  const hosts = ref<sshconfig.HostConfig[]>([]);
  const groupList = ref<groups.Group[]>([]);
  const activeView = ref<ActiveView | null>(null);
  const loading = ref(false);

  /** 兼容旧命名：主区/侧栏仍可能读 activeTab */
  const activeTab = computed(() => activeView.value);
  const activeTabId = computed(() => activeView.value?.id ?? null);

  const groupNodes = computed<GroupNode[]>(() => {
    const assigned = new Set<string>();
    const nodes: GroupNode[] = [];
    const sorted = [...groupList.value].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0)
    );
    for (const g of sorted) {
      const hs = hosts.value.filter((h) => (g.hosts || []).includes(h.name));
      hs.forEach((h) => assigned.add(h.name));
      nodes.push({ group: g, hosts: hs });
    }
    const rest = hosts.value.filter((h) => !assigned.has(h.name));
    if (rest.length > 0 || nodes.length === 0) {
      nodes.push({ group: null, hosts: rest });
    }
    return nodes;
  });

  async function refresh() {
    loading.value = true;
    try {
      const [h, g] = await Promise.all([api.listHostsAll(), api.listGroups()]);
      hosts.value = h || [];
      groupList.value = g || [];
    } finally {
      loading.value = false;
    }
  }

  function openHostTab(name: string) {
    const host = hosts.value.find((h) => h.name === name);
    if (!host) return;
    // 切换主机时保留同类型子页（若从分组切过来则回概览）
    const keepSub =
      activeView.value?.kind === "host" ? activeView.value.subTab : "overview";
    activeView.value = {
      id: name,
      title: name,
      subtitle: `${host.user || "?"}@${host.hostName || "?"}`,
      kind: "host",
      subTab: keepSub,
    };
  }

  function openGroupTab(id: string, title: string) {
    activeView.value = {
      id,
      title,
      kind: "group",
      subTab: "overview",
    };
  }

  function setSubTab(_tabId: string, sub: SubTab) {
    if (!activeView.value || activeView.value.kind !== "host") return;
    activeView.value = { ...activeView.value, subTab: sub };
  }

  async function createGroup(name: string) {
    const id = `g_${Date.now().toString(36)}`;
    await api.upsertGroup({
      id,
      name,
      order: groupList.value.length,
      hosts: [],
    } as groups.Group);
    await refresh();
    return id;
  }

  async function renameGroup(id: string, newName: string) {
    await api.renameGroup(id, newName);
    await refresh();
    if (activeView.value?.id === id) {
      activeView.value = { ...activeView.value, title: newName };
    }
  }

  async function assignHost(host: string, groupID: string) {
    await api.assignHost(host, groupID);
    await refresh();
  }

  return {
    hosts,
    groupList,
    activeView,
    activeTab,
    activeTabId,
    groupNodes,
    loading,
    refresh,
    openHostTab,
    openGroupTab,
    setSubTab,
    createGroup,
    renameGroup,
    assignHost,
  };
});
