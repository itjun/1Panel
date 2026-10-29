import { Events } from "@wailsio/runtime";
import { useSyncExternalStore } from "react";
import { api } from "@/api";
import { AgentInstallController, type AgentInstallProgress, type AgentRepairTarget } from "@/utils/agentInstall";

export const agentInstall = new AgentInstallController({
  install: hosts => api.batchInstallAgent(hosts),
  repair: targets => api.batchRepairAgent(targets),
  onProgress: listener => Events.On("agent-install-progress", (event: { data?: AgentInstallProgress }) => {
    if (event.data) listener(event.data);
  }),
});

export function openAgentInstall(hosts: string[]) {
  agentInstall.open(hosts);
}

export function startAgentRepair(targets: AgentRepairTarget[]) {
  void agentInstall.startRepair(targets);
}

export function useAgentInstall() {
  return useSyncExternalStore(agentInstall.subscribe, agentInstall.getSnapshot);
}
