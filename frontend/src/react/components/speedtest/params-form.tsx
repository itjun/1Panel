import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { speedtest } from "@/api";
import { InputNumber } from "@/react/components/ui/input-number";
import { RadioGroup } from "@/react/components/ui/radio-group";
import { Select } from "@/react/components/ui/select";
import { cn } from "@/react/lib/utils";

function Row({ label, tip, children }: { label: string; tip?: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 items-center gap-3">
      <span className="w-20 shrink-0 text-sm text-muted">
        {tip ? (
          <span data-tip={tip} className="cursor-help underline decoration-dotted underline-offset-4">
            {label}
          </span>
        ) : (
          label
        )}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
    </label>
  );
}

const CONGESTION = [
  { value: "", label: "系统默认" },
  { value: "cubic", label: "cubic" },
  { value: "bbr", label: "bbr" },
  { value: "reno", label: "reno" },
];

/**
 * 测速参数。fixedDirection：分组测速的星型固定双向、矩阵固定正向时隐藏方向。
 */
export function ParamsForm({
  value,
  onChange,
  disabled = false,
  fixedDirection,
  bandwidthExtra,
}: {
  value: speedtest.Params;
  onChange: (next: speedtest.Params) => void;
  disabled?: boolean;
  fixedDirection?: string;
  bandwidthExtra?: ReactNode;
}) {
  const [advanced, setAdvanced] = useState(false);
  const set = <K extends keyof speedtest.Params>(key: K, v: speedtest.Params[K]) => onChange({ ...value, [key]: v });
  const udp = value.protocol === "udp";

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-x-8 gap-y-3">
        <Row label="协议">
          <RadioGroup
            value={value.protocol}
            disabled={disabled}
            onChange={(v) => set("protocol", v)}
            options={[
              { value: "tcp", label: "TCP" },
              { value: "udp", label: "UDP" },
            ]}
          />
        </Row>
        <Row label="并发数" tip="iperf3 -P：同时开几条流，多条流更容易跑满带宽">
          <InputNumber value={value.parallel} min={1} max={64} disabled={disabled} onCommit={(v) => set("parallel", v)} />
        </Row>
        <Row label="时长" tip="iperf3 -t：测几秒">
          <InputNumber value={value.duration} min={3} max={300} disabled={disabled} onCommit={(v) => set("duration", v)} />
          <span className="text-sm text-muted">秒</span>
        </Row>
        {fixedDirection ? null : (
          <Row label="方向" tip="正向：A 发 B 收；反向：B 发 A 收；双向：两个方向同时测">
            <RadioGroup
              value={value.direction}
              disabled={disabled}
              onChange={(v) => set("direction", v)}
              options={[
                { value: "forward", label: "A→B" },
                { value: "reverse", label: "B→A" },
                { value: "bidir", label: "双向" },
              ]}
            />
          </Row>
        )}
        {udp ? (
          <Row label="目标带宽" tip="UDP 总目标带宽，会平均分到每条流；0 表示不限速（可能把链路打满）">
            <InputNumber
              value={value.udpBandwidthMbps}
              min={0}
              max={100000}
              step={100}
              disabled={disabled}
              onCommit={(v) => set("udpBandwidthMbps", v)}
            />
            <span className="text-sm text-muted">Mbps</span>
            {bandwidthExtra}
          </Row>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => setAdvanced((v) => !v)}
        className="motion-colors inline-flex w-fit items-center gap-1 rounded-control px-1 py-0.5 text-sm text-muted hover:text-ink"
        aria-expanded={advanced}
      >
        <ChevronDown className={cn("size-4 motion-colors", advanced ? "" : "-rotate-90")} />
        高级参数
      </button>

      {advanced ? (
        <div className="motion-fade-in grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-x-8 gap-y-3">
          <Row label="端口" tip="服务端监听端口；0 表示自动在 5201–5210 里找空闲端口">
            <InputNumber value={value.port} min={0} max={65535} disabled={disabled} onCommit={(v) => set("port", v)} />
          </Row>
          <Row label="忽略前几秒" tip="iperf3 -O：TCP 慢启动阶段不计入平均">
            <InputNumber value={value.omit} min={0} max={10} disabled={disabled} onCommit={(v) => set("omit", v)} />
            <span className="text-sm text-muted">秒</span>
          </Row>
          <Row label="采样间隔" tip="iperf3 -i：曲线每隔多久一个点">
            <RadioGroup
              value={String(value.interval)}
              disabled={disabled}
              onChange={(v) => set("interval", Number(v))}
              options={[
                { value: "0.5", label: "0.5 秒" },
                { value: "1", label: "1 秒" },
              ]}
            />
          </Row>
          <Row label="窗口大小" tip="iperf3 -w：socket 缓冲区；0 表示系统默认">
            <InputNumber value={value.windowKB} min={0} max={65536} step={64} disabled={disabled} onCommit={(v) => set("windowKB", v)} />
            <span className="text-sm text-muted">KB</span>
          </Row>
          {udp ? null : (
            <>
              <Row label="MSS" tip="iperf3 -M：TCP 最大分段；0 表示系统默认">
                <InputNumber value={value.mss} min={0} max={9000} disabled={disabled} onCommit={(v) => set("mss", v)} />
              </Row>
              <Row label="拥塞算法" tip="iperf3 -C：仅 Linux 客户端生效；对端内核不支持时测速会报错">
                <Select
                  value={value.congestion}
                  disabled={disabled}
                  onChange={(v) => set("congestion", v)}
                  options={CONGESTION}
                  className="w-40"
                />
              </Row>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
