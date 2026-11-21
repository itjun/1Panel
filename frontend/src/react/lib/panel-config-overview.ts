import { queryOptions } from "@tanstack/react-query";
import { api, type main } from "@/api";

export const panelConfigOverviewQuery = queryOptions({
  queryKey: ["config-overview"],
  queryFn: () => api.getPanelConfigOverview(),
  staleTime: 3000,
});

export function panelConfigNeedsAttention(overview?: main.PanelConfigOverview) {
  return !!(overview?.configStale || overview?.drift || overview?.needsReview);
}
