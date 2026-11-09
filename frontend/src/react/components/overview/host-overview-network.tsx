import { Cable, Network } from "lucide-react";
import type { monitor } from "@/api";
import { DetailFact, OverviewDetails } from "@/react/components/local/overview-details";
import { Tag } from "@/react/components/ui/tag";
import { formatBytes } from "@/utils/format";
import { formatIpLocation } from "@/utils/ip-location";

const KIND_LABEL: Record<string, string> = { physical: "物理网卡", docker: "Docker", virtual: "虚拟网卡", loopback: "回环", other: "其它" };

export function HostOverviewNetwork({ network, privateIP, publicIP, isUnavailable, isLoading }: {
  network?: monitor.NetworkSnapshot;
  privateIP?: string;
  publicIP?: string;
  isUnavailable: boolean;
  isLoading: boolean;
}) {
  const interfaces = network?.interfaces || [];
  const location = publicIP && publicIP === network?.egressPublicIP ? formatIpLocation(network.egressPublicLoc) : "";
  const shown = [...interfaces].sort((a, b) =>
    Number(b.kind === "physical") - Number(a.kind === "physical") ||
    Number(b.state === "UP") - Number(a.state === "UP") ||
    Number(!!b.ipv4?.length) - Number(!!a.ipv4?.length) || a.name.localeCompare(b.name)
  ).slice(0, 3);
  return <section className="local-summary-network" aria-label="网络摘要">
    <h2><OverviewDetails label="网络详情" className="local-summary-network-title" trigger={<><Network size={20} aria-hidden /><span>网络</span></>}>
      <h2><Network size={20} aria-hidden />网络</h2>
      {isUnavailable ? <p>{network ? "网络采集异常，以下为最后已知信息" : "网络信息暂不可用"}</p> : null}
      <dl>
        <DetailFact label="内网 IP">{privateIP || "—"}</DetailFact>
        <DetailFact label="公网 IP">{publicIP || "—"}</DetailFact>
        <DetailFact label="公网归属地">{network?.egressPublicLoc || "—"}</DetailFact>
        <DetailFact label="默认网关">{network?.defaultGateway || "—"}</DetailFact>
        <DetailFact label="Docker 网桥">{network?.dockerIPs?.join(", ") || "—"}</DetailFact>
        <DetailFact label="网卡">{interfaces.length} 个</DetailFact>
      </dl>
      {interfaces.map(iface => <dl key={iface.name}><DetailFact label={iface.name}>{iface.ipv4?.join(", ") || "—"} / {iface.state || "未知"}</DetailFact></dl>)}
    </OverviewDetails></h2>
    {isUnavailable ? <p className="device-overview-reading-error" role="status">网络采集异常{network ? "，显示上次读数" : ""}</p> : null}
    {shown.length ? <div className="local-summary-interfaces">
      {shown.map(iface => {
        const Icon = iface.kind === "physical" ? Cable : Network;
        const state = iface.state === "UP" ? "已连接" : iface.state === "DOWN" ? "未连接" : "状态未知";
        return <div className="local-summary-interface" key={iface.name}>
          <OverviewDetails label={`${iface.name} 网卡详情`} className="local-summary-network-icon" trigger={<Icon size={28} strokeWidth={1.5} aria-hidden />}>
            <h2><Icon size={20} aria-hidden />{iface.name}</h2>
            {isUnavailable ? <p>上次读数</p> : null}
            <dl>
              <DetailFact label="类型">{KIND_LABEL[iface.kind] || iface.kind || "—"}</DetailFact>
              <DetailFact label="状态">{state}</DetailFact>
              <DetailFact label="IPv4">{iface.ipv4?.join(", ") || "—"}</DetailFact>
              <DetailFact label="MAC">{iface.mac || "—"}</DetailFact>
              <DetailFact label="MTU">{iface.mtu || "—"}</DetailFact>
              <DetailFact label="接收（累计）">{formatBytes(iface.rxBytes)}</DetailFact>
              <DetailFact label="发送（累计）">{formatBytes(iface.txBytes)}</DetailFact>
            </dl>
          </OverviewDetails>
          <div className="local-summary-interface-copy"><div><strong>{KIND_LABEL[iface.kind] || "网卡"}</strong><span>{iface.name}</span><Tag tone={!isUnavailable && iface.state === "UP" ? "ok" : "neutral"}>{isUnavailable ? "上次读数" : state}</Tag></div><p>{iface.ipv4?.join(", ") || "—"}</p></div>
        </div>;
      })}
    </div> : <p className="text-sm text-muted">{isLoading ? "加载中…" : privateIP || "暂无网卡数据"}</p>}
    <p className="local-summary-public-ip"><span>公网 IP</span>{publicIP || "—"}{location ? <span title={network?.egressPublicLoc}>{location}</span> : null}</p>
  </section>;
}
