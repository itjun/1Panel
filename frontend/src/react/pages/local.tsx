import { LocalAppsPage } from "@/react/components/local/apps-page";
import { LocalAptPage } from "@/react/components/local/apt-page";
import { LocalHostsPage } from "@/react/components/local/hosts-page";
import { LocalMonitorPage } from "@/react/components/local/monitor-page";
import { LocalNetworkPage } from "@/react/components/local/network-page";
import { LocalNginxPage } from "@/react/components/local/nginx-page";
import { LocalOverviewPage } from "@/react/components/local/overview-page";
import { LocalPackagesPage } from "@/react/components/local/packages-page";
import { LocalStoragePage } from "@/react/components/local/storage-page";
import { useSession, type LocalSection } from "@/react/state/session";
import { isLinuxPlatform } from "@/react/lib/platform";

export function LocalPage() {
  const session = useSession();
  const section = session.localSection;
  if (section === "monitor") return <LocalMonitorPage />;
  if (section === "procs") return <LocalAppsPage />;
  if (section === "packages") return <LocalPackagesPage />;
  if (section === "apt" && isLinuxPlatform()) return <LocalAptPage />;
  if (section === "storage") return <LocalStoragePage />;
  if (section === "network") return <LocalNetworkPage />;
  if (section === "nginx") return <LocalNginxPage />;
  if (section === "hosts") return <LocalHostsPage />;
  return <LocalOverviewPage />;
}

export const LOCAL_SECTIONS: { id: LocalSection; label: string }[] = [
  { id: "overview", label: "系统概览" },
  { id: "monitor", label: "性能监控" },
  { id: "procs", label: "应用进程" },
  { id: "packages", label: "软件列表" },
  // 软件源是 apt（/etc/apt）专属概念，仅 Linux 侧栏显示
  ...(isLinuxPlatform() ? [{ id: "apt" as const, label: "软件源" }] : []),
  { id: "storage", label: "磁盘空间" },
  { id: "network", label: "网络信息" },
  { id: "nginx", label: "Nginx" },
  { id: "hosts", label: "Hosts" },
];
