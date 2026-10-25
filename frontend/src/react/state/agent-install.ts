import { Events } from "@wailsio/runtime";
import { useSyncExternalStore } from "react";
import { api } from "@/api";
import { AgentInstallController, type AgentInstallProgress } from "@/utils/agentInstall";

export const agentInstall = new AgentInstallController({
  install: hosts => api.batchInstallAgent(hosts),
  onProgress: listener => Events.On("agent-install-progress", (event: { data?: AgentInstallProgress }) => {
    if (event.data) listener(event.data);
  }),
});

export function openAgentInstall(hosts: string[]) {
  agentInstall.open(hosts);
}

export function useAgentInstall() {
  return useSyncExternalStore(agentInstall.subscribe, agentInstall.getSnapshot);
}
