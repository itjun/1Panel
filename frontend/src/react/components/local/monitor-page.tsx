import { useMemo } from "react";
import { Notice, Page } from "@/react/components/page";
import {
  binaryAxis,
  ChartHost,
  lineOption,
  MonitorPanel,
  readoutTone,
  RX_TIP,
  TX_TIP,
  type MonitorReadout,
} from "@/react/components/monitor/charts";
import { useThemeMode } from "@/react/lib/use-theme-mode";
import { usageBands } from "@/react/lib/usage-tone";
import { formatBytes, formatErr, formatMemCapacity, formatRateKBps } from "@/utils/format";
import { refreshLocalMetrics, useLocalMetrics } from "./use-local-metrics";

const CONNECT_GROUP = "monitor-local";
const CPU_BANDS = usageBands(100);

function lastValue(values: number[], format: (v: number) => string): string {
  if (!values.length) return "—";
  return format(values[values.length - 1]!);
}

export function LocalMonitorPage() {
  const {
    overview: data,
    error,
    cpuSeries,
    loadSeries,
    memSeries,
    netSeries,
    ioSeries,
  } = useLocalMetrics();
  const themeMode = useThemeMode();

  const cpuValues = cpuSeries.map((p) => p.value);
  const loadValues = loadSeries.map((p) => p.value);
  const memValues = memSeries.map((p) => p.used);
  const swapValues = memSeries.map((p) => p.swap);
  const rxValues = netSeries.map((p) => p.rx);
  const txValues = netSeries.map((p) => p.tx);
  const readValues = ioSeries.map((p) => p.read);
  const writeValues = ioSeries.map((p) => p.write);

  const memAxis = useMemo(
    () => binaryAxis(memSeries.flatMap((p) => [p.used, p.swap]), 0),
    [memSeries],
  );
  const netAxis = useMemo(
    () => binaryAxis(netSeries.flatMap((p) => [p.rx, p.tx]), -1),
    [netSeries],
  );
  const ioAxis = useMemo(
    () => binaryAxis(ioSeries.flatMap((p) => [p.read, p.write]), -1),
    [ioSeries],
  );

  const cpuBands = CPU_BANDS;
  const loadBands = useMemo(() => usageBands(data?.cpuCount), [data?.cpuCount]);
  const memBands = useMemo(() => usageBands(data?.memTotal), [data?.memTotal]);

  const cpuOpt = useMemo(
    () =>
      lineOption(
        cpuSeries.map((p) => p.time),
        [{ name: "CPU 使用率", data: cpuSeries.map((p) => p.value), bands: cpuBands }],
        { yMax: 100, yFormatter: (v) => `${v.toFixed(2)}%` },
      ),
    // themeMode 变化时重读 CSS 变量里的曲线色
    [cpuSeries, themeMode],
  );
  const loadOpt = useMemo(
    () =>
      lineOption(
        loadSeries.map((p) => p.time),
        [{ name: "1 分钟负载", data: loadSeries.map((p) => p.value), bands: loadBands }],
        { yFormatter: (v) => v.toFixed(2) },
      ),
    [loadSeries, loadBands, themeMode],
  );
  const memOpt = useMemo(
    () =>
      lineOption(
        memSeries.map((p) => p.time),
        [
          { name: "已用", data: memSeries.map((p) => p.used), bands: memBands },
          { name: "交换", data: memSeries.map((p) => p.swap), muted: true },
        ],
        {
          yFormatter: (v) => formatBytes(v, 2),
          yMax: memAxis?.max,
          yInterval: memAxis?.interval,
        },
      ),
    [memSeries, memAxis, memBands, themeMode],
  );

  const cpuTone = readoutTone(cpuValues[cpuValues.length - 1], cpuBands);
  const loadTone = readoutTone(data ? data.load1 : loadValues[loadValues.length - 1], loadBands);
  const memTone = readoutTone(memValues[memValues.length - 1], memBands);
  const netOpt = useMemo(
    () =>
      lineOption(
        netSeries.map((p) => p.time),
        [
          { name: "流入", data: netSeries.map((p) => p.rx) },
          { name: "流出", data: netSeries.map((p) => p.tx) },
        ],
        {
          yFormatter: (v) => formatRateKBps(v),
          axisFormatter: (v) => formatRateKBps(v).replace(".00 ", " "),
          yMax: netAxis?.max,
          yInterval: netAxis?.interval,
        },
      ),
    [netSeries, netAxis, themeMode],
  );
  const ioOpt = useMemo(
    () =>
      lineOption(
        ioSeries.map((p) => p.time),
        [
          { name: "读", data: ioSeries.map((p) => p.read) },
          { name: "写", data: ioSeries.map((p) => p.write) },
        ],
        {
          yFormatter: (v) => formatRateKBps(v),
          axisFormatter: (v) => formatRateKBps(v).replace(".00 ", " "),
          yMax: ioAxis?.max,
          yInterval: ioAxis?.interval,
        },
      ),
    [ioSeries, ioAxis, themeMode],
  );

  let cpuNote: string | undefined;
  if (data) {
    cpuNote = `${data.cpuCount} 核`;
    if ((data.perfCores || 0) > 0 || (data.effCores || 0) > 0) {
      cpuNote = `${data.cpuCount} 核 · 性能 ${(data.perfCpuPercent || 0).toFixed(1)}% · 能效 ${(data.effCpuPercent || 0).toFixed(1)}%`;
    }
  }

  let loadNote: string | undefined;
  if (data) {
    let loadPct = 0;
    if (data.cpuCount) loadPct = (data.load1 / data.cpuCount) * 100;
    if (loadPct < 30) loadNote = "运行流畅";
    else if (loadPct < 70) loadNote = "运行正常";
    else if (loadPct < 80) loadNote = "运行缓慢";
    else loadNote = "运行堵塞";
  }

  let loadReadouts: MonitorReadout[] = [
    { label: "1 分钟", value: lastValue(loadValues, (v) => v.toFixed(2)), tone: loadTone },
  ];
  if (data) {
    loadReadouts = [
      { label: "1 分钟", value: data.load1.toFixed(2), tone: loadTone },
      { label: "5 分钟", value: data.load5.toFixed(2), tone: readoutTone(data.load5, loadBands) },
      { label: "15 分钟", value: data.load15.toFixed(2), tone: readoutTone(data.load15, loadBands) },
    ];
  }

  let memNote: string | undefined;
  if (data) {
    memNote = `总量 ${formatMemCapacity(data.memTotal || 0)}`;
    if ((data.swapTotal || 0) > 0) {
      memNote += ` · 交换 ${formatBytes(data.swapTotal)}`;
    }
  }

  return (
    <Page title="性能监控" onRefresh={() => refreshLocalMetrics()}>
      {error && !data ? <Notice text={formatErr(error)} /> : null}

      {/* 单元之间 1px 细线分隔（容器 line 底 + 1px 间隙）；宽屏时最后一行（磁盘 IO）吃掉剩余高度 */}
      <div className="grid grid-cols-1 gap-px bg-line lg:flex-1 lg:grid-cols-2 lg:grid-rows-[auto_auto_1fr]">
        <MonitorPanel
          title="CPU"
          note={cpuNote}
          readouts={[
            {
              label: "当前",
              value: lastValue(cpuValues, (v) => `${v.toFixed(1)}%`),
              tone: cpuTone,
            },
          ]}
        >
          <ChartHost option={cpuOpt} connectGroup={CONNECT_GROUP} />
        </MonitorPanel>
        <MonitorPanel title="负载" note={loadNote} readouts={loadReadouts}>
          <ChartHost option={loadOpt} connectGroup={CONNECT_GROUP} />
        </MonitorPanel>
        <MonitorPanel
          title="内存"
          note={memNote}
          readouts={[
            {
              label: "已用",
              swatch: memTone ?? "read",
              value: lastValue(memValues, (v) => formatBytes(v)),
              tone: memTone,
            },
            {
              label: "交换",
              swatch: "muted",
              value: lastValue(swapValues, (v) => formatBytes(v)),
            },
          ]}
        >
          <ChartHost option={memOpt} connectGroup={CONNECT_GROUP} />
        </MonitorPanel>
        <MonitorPanel
          title="流量"
          readouts={[
            {
              label: "流入",
              swatch: "read",
              tip: RX_TIP,
              value: lastValue(rxValues, (v) => formatRateKBps(v)),
            },
            {
              label: "流出",
              swatch: "write",
              tip: TX_TIP,
              value: lastValue(txValues, (v) => formatRateKBps(v)),
            },
          ]}
        >
          <ChartHost option={netOpt} connectGroup={CONNECT_GROUP} />
        </MonitorPanel>
        <MonitorPanel
          title="磁盘 IO"
          className="lg:col-span-2"
          grow
          readouts={[
            {
              label: "读",
              swatch: "read",
              value: lastValue(readValues, (v) => formatRateKBps(v)),
            },
            {
              label: "写",
              swatch: "write",
              value: lastValue(writeValues, (v) => formatRateKBps(v)),
            },
          ]}
        >
          <ChartHost option={ioOpt} connectGroup={CONNECT_GROUP} />
        </MonitorPanel>
      </div>
    </Page>
  );
}
