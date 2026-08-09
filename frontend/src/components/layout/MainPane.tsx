import { useState } from "react";
import {
  Activity,
  Boxes,
  Terminal,
  ListTree,
  ScrollText,
  Package,
  Server,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { OverviewTab } from "@/components/overview/OverviewTab";
import { ProcessesTab } from "@/components/processes/ProcessesTab";
import { DockerTab } from "@/components/docker/DockerTab";
import { TerminalTab } from "@/components/terminal/TerminalTab";
import { ServicesTab } from "@/components/overview/ServicesTab";
import { CronTab } from "@/components/overview/CronTab";
import { PackagesTab } from "@/components/overview/PackagesTab";
import { GroupOverview } from "@/components/group/GroupOverview";
import { useApp } from "@/store/app";

type TabKey =
  | "overview"
  | "processes"
  | "docker"
  | "terminal"
  | "services"
  | "cron"
  | "packages";

export function MainPane() {
  const { selection, hosts, selectHost } = useApp();
  const [tab, setTab] = useState<TabKey>("overview");

  if (!selection) {
    return <EmptyState />;
  }

  // 分组概览页
  if (selection.type === "group") {
    return (
      <main className="flex flex-1 flex-col overflow-hidden bg-background">
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-secondary">
            <Boxes className="h-3.5 w-3.5" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold leading-tight">
              {selection.name}
            </span>
            <span className="text-[10px] text-muted-foreground">
              分组概览
            </span>
          </div>
        </div>
        <div className="flex-1 overflow-hidden p-5 pt-3">
          <GroupOverview
            groupID={selection.id}
            groupName={selection.name}
            onPickHost={(name) => selectHost(name)}
          />
        </div>
      </main>
    );
  }

  // 主机详情页
  const host = hosts.find((h) => h.name === selection.name);
  if (!host) {
    return <EmptyState />;
  }

  return (
    <main className="flex flex-1 flex-col overflow-hidden bg-background">
      {/* 主机标题条 */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-5">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-secondary">
          <Server className="h-3.5 w-3.5" />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold leading-tight">
            {host.name}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {host.user}@{host.hostName}
            {host.port && host.port !== "22" ? `:${host.port}` : ""}
          </span>
        </div>
      </div>

      {/* Tab 区 */}
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as TabKey)}
        className="flex flex-1 flex-col overflow-hidden px-5 pt-3"
      >
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="overview">
              <Activity className="h-3 w-3" />
              概览
            </TabsTrigger>
            <TabsTrigger value="processes">
              <ListTree className="h-3 w-3" />
              进程
            </TabsTrigger>
            <TabsTrigger value="docker">
              <Boxes className="h-3 w-3" />
              Docker
            </TabsTrigger>
            <TabsTrigger value="services">
              <Boxes className="h-3 w-3" />
              服务
            </TabsTrigger>
            <TabsTrigger value="cron">
              <ScrollText className="h-3 w-3" />
              定时任务
            </TabsTrigger>
            <TabsTrigger value="packages">
              <Package className="h-3 w-3" />
              软件包
            </TabsTrigger>
            <TabsTrigger value="terminal">
              <Terminal className="h-3 w-3" />
              终端
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="mt-3 flex-1 overflow-hidden">
          <OverviewTab host={host.name} />
        </TabsContent>
        <TabsContent value="processes" className="mt-3 flex-1 overflow-hidden">
          <ProcessesTab host={host.name} />
        </TabsContent>
        <TabsContent value="docker" className="mt-3 flex-1 overflow-hidden">
          <DockerTab host={host.name} />
        </TabsContent>
        <TabsContent value="services" className="mt-3 flex-1 overflow-hidden">
          <ServicesTab host={host.name} />
        </TabsContent>
        <TabsContent value="cron" className="mt-3 flex-1 overflow-hidden">
          <CronTab host={host.name} />
        </TabsContent>
        <TabsContent value="packages" className="mt-3 flex-1 overflow-hidden">
          <PackagesTab host={host.name} />
        </TabsContent>
        <TabsContent value="terminal" className="mt-3 flex-1 overflow-hidden">
          <TerminalTab host={host.name} />
        </TabsContent>
      </Tabs>
    </main>
  );
}

function EmptyState() {
  return (
    <main className="flex flex-1 items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
          <Server className="h-8 w-8 text-muted-foreground" />
        </div>
        <div>
          <h2 className="text-base font-semibold">选择一台主机或分组</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            从左侧列表选择分组看总览，或选择单台主机看详情
          </p>
        </div>
      </div>
    </main>
  );
}
