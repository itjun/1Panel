import { GroupView } from "@/react/components/speedtest/group-view";
import { HistoryView } from "@/react/components/speedtest/history-view";
import { PairView } from "@/react/components/speedtest/pair-view";
import { useSession } from "@/react/state/session";

/** 网络测速：两机 / 分组 / 历史，由二级栏切换 */
export function SpeedtestPage() {
  const { speedtestSection } = useSession();
  if (speedtestSection === "group") return <GroupView />;
  if (speedtestSection === "history") return <HistoryView />;
  return <PairView />;
}
