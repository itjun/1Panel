import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowRight, CheckCircle2 } from "lucide-react";
import { api, type monitor } from "@/api";
import { Button } from "@/react/components/ui/button";
import { Meter } from "@/react/components/ui/meter";
import { useSession } from "@/react/state/session";
import {
  isCpuAlert,
  isMemAlert,
  isDiskFull,
  isLoadAlert,
  summarizeDisks,
} from "@/utils/alerts";
import { formatBytes, formatMemCapacity } from "@/utils/format";
import {
  focusHost,
  readHostFocus,
  useWorkbenchState,
  useTrendWindow,
} from "./state";
import { RangeControls, ResourceTrends } from "./resource-trends";

export function HostWorkbenchSummary({
  host,
  data,
  disks,
  unavailable,
  sampledAt,
}: {
  host: string;
  data?: monitor.Overview;
  disks?: monitor.DiskInfo[];
  unavailable: boolean;
  sampledAt: number;
}) {
  const session = useSession();
  const context = readHostFocus(host);
  const [range, setRange] = useWorkbenchState(
    `host-range:${host}`,
    context.range,
  );
  const window = useTrendWindow(range);
  const disk = summarizeDisks(disks);
  const events = useQuery({
    queryKey: ["workbench-events", host],
    queryFn: () => api.listAlertHistoryByHost(host, 20),
    refetchInterval: 15000,
  });
  const procs = useQuery({
    queryKey: ["procs", host],
    queryFn: () => api.collectProcesses(host, 200),
    enabled: !!data && !unavailable,
    refetchInterval: 5000,
  });
  const list = [...(procs.data || [])]
    .sort((a, b) => b.rss - a.rss)
    .slice(0, 5);
  const alerts =
    !unavailable && data
      ? [
          [isCpuAlert(data), "CPU"],
          [isMemAlert(data), "内存"],
          [isLoadAlert(data), "负载"],
          [isDiskFull(disks), "磁盘"],
        ]
          .filter(([active]) => active)
          .map(([, label]) => String(label))
      : [];
  const openProcesses = (pid?: number) => {
    focusHost(host, { processSort: "rss", pid });
    session.setTool("processes");
  };
  const loadPercent = data?.cpuCount ? (data.load1 / data.cpuCount) * 100 : 0;
  const loadWord = loadPercent < 30 ? "运行流畅" : loadPercent < 70 ? "运行正常" : loadPercent < 80 ? "运行缓慢" : "运行堵塞";
  const swapText = data && data.swapTotal > 0
    ? `${formatBytes(data.swapUsed)} / ${formatBytes(data.swapTotal)} · ${(data.swapPercent || 0).toFixed(1)}%`
    : "未启用";
  const items = [
    {
      label: "CPU",
      tooltip: data ? `型号：${data.cpuModel || "—"}\n核心数：${data.cpuCount} 核\n使用率：${(data.cpuPercent || 0).toFixed(2)}%` : "等待采样",
      value: data?.cpuPercent,
      text: data ? `${data.cpuPercent.toFixed(1)}%` : "—",
      detail: data ? `${data.cpuCount} 核` : "",
    },
    {
      label: "内存",
      tooltip: data ? `总量：${formatMemCapacity(data.memTotal)}\n已用：${formatBytes(data.memUsed)}\n可用：${formatBytes(Math.max(0, (data.memTotal || 0) - (data.memUsed || 0)))}\n使用率：${(data.memPercent || 0).toFixed(2)}%\nSwap：${swapText}` : "等待采样",
      value: data?.memPercent,
      text: data ? `${data.memPercent.toFixed(1)}%` : "—",
      detail: data
        ? `${formatBytes(data.memUsed)} / ${formatBytes(data.memTotal)}`
        : "",
    },
    {
      label: "磁盘",
      tooltip: disk ? `范围：${disk.count} ${disk.scope === "disk" ? "块物理盘" : "个分区"}\n总量：${formatBytes(disk.total)}\n已用：${formatBytes(disk.used)}\n可用：${formatBytes(disk.avail)}` : "暂无磁盘数据",
      value: disk?.percent,
      text: disk ? `${disk.percent.toFixed(1)}%` : "—",
      detail: disk
        ? `${formatBytes(disk.used)} / ${formatBytes(disk.total)}`
        : "",
    },
    {
      label: "负载",
      tooltip: data ? `1 分钟：${data.load1.toFixed(2)}\n5 分钟：${(data.load5 || 0).toFixed(2)}\n15 分钟：${(data.load15 || 0).toFixed(2)}\n${loadWord}` : "等待采样",
      value: data?.cpuCount ? (data.load1 / data.cpuCount) * 100 : undefined,
      text: data ? data.load1.toFixed(2) : "—",
      detail: data ? `/ ${data.cpuCount} 核` : "",
    },
  ];
  return (
    <div className="host-workbench-summary">
      {!!alerts.length && (
        <div className="workbench-alert">
          <AlertCircle size={20} />
          <span>{alerts.join("、")}达到危险档</span>
          <Button variant="primary" onClick={() => openProcesses()}>
            查看进程
          </Button>
        </div>
      )}
      <div className="workbench-sample">
        {unavailable ? "最后已知读数" : "当前"}
        <span>
          {sampledAt
            ? new Date(sampledAt).toLocaleString("zh-CN", { hour12: false })
            : "等待采样"}
        </span>
      </div>
      <div className="workbench-metrics">
        {items.map((item) => (
          <div key={item.label} tabIndex={0} data-tip={item.tooltip} aria-label={`${item.label}明细`}>
            <span>{item.label}</span>
            <p>
              <strong>{item.text}</strong>
              <small>{item.detail}</small>
            </p>
            <Meter value={item.value} showValue={false} className="w-full" />
          </div>
        ))}
      </div>
      <div className="workbench-section-heading">
        <h2>资源趋势</h2>
        <RangeControls
          value={range}
          from={window.from}
          to={window.to}
          onChange={(next) => {
            setRange(next);
            focusHost(host, { range: next });
          }}
        />
      </div>
      <ResourceTrends
        host={host}
        overview={data}
        from={window.from}
        to={window.to}
        primary={context.metric}
      />
      <div className="workbench-diagnostics">
        <section>
          <div className="workbench-section-heading">
            <h2>当前进程</h2>
            <span className="text-xs text-muted">按内存排序</span>
            <Button variant="ghost" size="sm" onClick={() => openProcesses()}>
              全部进程
              <ArrowRight size={14} />
            </Button>
          </div>
          <p className="mb-2 text-xs text-muted">
            {procs.dataUpdatedAt
              ? new Date(procs.dataUpdatedAt).toLocaleTimeString("zh-CN", {
                  hour12: false,
                })
              : "等待采样"}{" "}
            · 当前快照，不代表历史时段
          </p>
          {unavailable || procs.isError ? (
            <p className="py-6 text-sm text-muted">
              采集不可用，无法获取当前进程
            </p>
          ) : (
            <div className="overflow-auto">
              <table className="workbench-procs">
                <thead>
                  <tr>
                    <th>进程</th>
                    <th>PID</th>
                    <th>内存</th>
                    <th>CPU</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((p) => (
                    <tr key={p.pid}>
                      <td title={p.cmd}>{p.cmd}</td>
                      <td>{p.pid}</td>
                      <td>{formatBytes(p.rss)}</td>
                      <td>{p.cpu.toFixed(1)}%</td>
                      <td>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openProcesses(p.pid)}
                        >
                          查看详情
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!list.length && (
                <p className="py-6 text-sm text-muted">
                  {procs.isPending ? "读取进程中…" : "暂无进程"}
                </p>
              )}
            </div>
          )}
        </section>
        <section>
          <div className="workbench-section-heading">
            <h2>最近事件</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const first = events.data?.[0];
                if (first)
                  sessionStorage.setItem("1pannel-focus-alert-id", first.id);
                session.setNotifySection("metricMessages");
                session.setWorkspace("notify");
              }}
            >
              全部事件
              <ArrowRight size={14} />
            </Button>
          </div>
          {(events.data || []).slice(0, 3).map((event) => (
            <article key={event.id} className="workbench-event">
              {event.state === "up" ? (
                <CheckCircle2 size={17} className="text-success" />
              ) : (
                <AlertCircle size={17} className="text-danger" />
              )}
              <div>
                <time>
                  {new Date(event.at).toLocaleString("zh-CN", {
                    hour12: false,
                  })}
                </time>
                <strong>{event.title}</strong>
                <p>{event.detail || event.value}</p>
              </div>
            </article>
          ))}
          {!events.data?.length && (
            <p className="py-6 text-sm text-muted">
              {events.isPending
                ? "读取事件中…"
                : events.isError
                  ? "事件读取失败"
                  : "暂无已记录事件"}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
