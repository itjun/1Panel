import { ArrowDown, ArrowUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { monitor } from "@/api";
import { counterRate } from "@/utils/counterRate";
import { formatBytes } from "@/utils/format";

export function NetworkRates({
  overview,
  sampledAt,
}: {
  overview?: monitor.Overview | null;
  sampledAt: number;
}) {
  const previous = useRef<{ at: number; rx: number; tx: number } | null>(null);
  const [rates, setRates] = useState<{ rx?: number; tx?: number }>({});
  useEffect(() => {
    if (!overview || !sampledAt) {
      previous.current = null;
      setRates({});
      return;
    }
    const last = previous.current;
    if (last?.at === sampledAt) return;
    setRates({
      rx: counterRate(
        last?.rx,
        overview.netRxBytes,
        sampledAt - (last?.at || 0),
      ),
      tx: counterRate(
        last?.tx,
        overview.netTxBytes,
        sampledAt - (last?.at || 0),
      ),
    });
    previous.current = {
      at: sampledAt,
      rx: overview.netRxBytes,
      tx: overview.netTxBytes,
    };
  }, [overview, sampledAt]);
  return (
    <>
      <span title="相邻成功采样之间的接收速率">
        <ArrowDown size={14} />
        接收 {overview && rates.rx != null ? `${formatBytes(rates.rx)}/s` : "—"}
      </span>
      <span title="相邻成功采样之间的发送速率">
        <ArrowUp size={14} />
        发送 {overview && rates.tx != null ? `${formatBytes(rates.tx)}/s` : "—"}
      </span>
    </>
  );
}
