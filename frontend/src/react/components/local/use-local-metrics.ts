import { useEffect, useRef, useState } from "react";
import { api, type localsys } from "@/api";
import { bytesToKBps } from "@/utils/format";

const POLL_MS = 2000;
/** 曲线落点节流（秒） */
const CHART_GRAIN_SEC = 5;
const WINDOW = 100;

export type CpuPoint = {
  time: string;
  total: number;
  perf: number;
  eff: number;
};
export type MemPoint = { time: string; phys: number; swap: number };
export type IOPoint = { time: string; read: number; write: number };

function liveTimeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * 本机概览指标：轮询 Overview，维护 CPU/内存/磁盘 IO 滑动窗口。
 * 对齐 Vue localMetrics store。
 */
export function useLocalMetrics(enabled = true) {
  const [overview, setOverview] = useState<localsys.Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cpuSeries, setCpuSeries] = useState<CpuPoint[]>([]);
  const [memSeries, setMemSeries] = useState<MemPoint[]>([]);
  const [ioSeries, setIoSeries] = useState<IOPoint[]>([]);
  const [ioRates, setIoRates] = useState({ readBps: 0, writeBps: 0, iops: 0 });
  const [memTotalBytes, setMemTotalBytes] = useState(0);

  const lastDiskRef = useRef<{
    read: number;
    write: number;
    count: number;
    ts: number;
  } | null>(null);
  const lastChartAtRef = useRef(0);
  const tickGenRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    function takeChartSlot(now: number): boolean {
      const need = CHART_GRAIN_SEC * 1000;
      if (lastChartAtRef.current > 0 && now - lastChartAtRef.current < need) {
        return false;
      }
      lastChartAtRef.current = now;
      return true;
    }

    function pushDiskIO(data: localsys.Overview, appendChart: boolean) {
      const now = Date.now();
      const read = Number(data.diskReadBytes) || 0;
      const write = Number(data.diskWriteBytes) || 0;
      const count = Number(data.diskIOCount) || 0;
      const prev = lastDiskRef.current;
      lastDiskRef.current = { read, write, count, ts: now };
      if (!prev || now <= prev.ts || read < prev.read || write < prev.write) {
        if (appendChart) {
          setIoSeries((prevSeries) =>
            [...prevSeries, { time: liveTimeLabel(now), read: 0, write: 0 }].slice(
              -WINDOW,
            ),
          );
        }
        return;
      }
      const dt = now - prev.ts;
      setIoRates({
        readBps: ((read - prev.read) / dt) * 1000,
        writeBps: ((write - prev.write) / dt) * 1000,
        iops: Math.round(((count - prev.count) / dt) * 1000),
      });
      if (!appendChart) return;
      setIoSeries((prevSeries) =>
        [
          ...prevSeries,
          {
            time: liveTimeLabel(now),
            read: bytesToKBps(read - prev.read, dt),
            write: bytesToKBps(write - prev.write, dt),
          },
        ].slice(-WINDOW),
      );
    }

    function pushCpuMem(data: localsys.Overview) {
      const time = liveTimeLabel(Date.now());
      setCpuSeries((prev) =>
        [
          ...prev,
          {
            time,
            total: Number(data.cpuPercent) || 0,
            perf: Number(data.perfCpuPercent) || 0,
            eff: Number(data.effCpuPercent) || 0,
          },
        ].slice(-WINDOW),
      );
      setMemSeries((prev) =>
        [
          ...prev,
          {
            time,
            phys: Number(data.memUsed) || 0,
            swap: Number(data.swapUsed) || 0,
          },
        ].slice(-WINDOW),
      );
    }

    function ingest(data: localsys.Overview) {
      setOverview(data);
      const total = Number(data.memTotal) || 0;
      if (total > 0) setMemTotalBytes(total);
      const append = takeChartSlot(Date.now());
      pushDiskIO(data, append);
      if (append) pushCpuMem(data);
    }

    async function tick() {
      const my = ++tickGenRef.current;
      try {
        const data = await api.localSysOverview();
        if (my !== tickGenRef.current) return;
        ingest(data);
        setError(null);
      } catch (e) {
        if (my !== tickGenRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (my === tickGenRef.current) setLoading(false);
      }
    }

    setLoading(true);

    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      tickGenRef.current += 1;
      clearInterval(timer);
    };
  }, [enabled]);

  const hasCpuClusters =
    !!overview && ((overview.perfCores || 0) > 0 || (overview.effCores || 0) > 0);

  return {
    overview,
    error,
    loading,
    cpuSeries,
    memSeries,
    ioSeries,
    ioRates,
    memTotalBytes,
    hasCpuClusters,
  };
}
