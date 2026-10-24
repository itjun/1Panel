import { useEffect, useSyncExternalStore } from "react";
import { api } from "@/api";
import { HostCardPoller } from "@/utils/hostCardPoller";

const poller = new HostCardPoller((host, isDetailsIncluded) => api.getHostCardSnapshot(host, isDetailsIncluded));

export function useHostCards(names: string[]) {
  const key = JSON.stringify([...new Set(names)].sort());
  const store = useSyncExternalStore(poller.subscribe, poller.getSnapshot, poller.getSnapshot);
  useEffect(() => { poller.setHosts(JSON.parse(key) as string[]); }, [key]);
  useEffect(() => {
    const updateVisibility = () => poller.setActive(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", updateVisibility);
    updateVisibility();
    return () => {
      document.removeEventListener("visibilitychange", updateVisibility);
      poller.setActive(false);
    };
  }, []);
  return store;
}
