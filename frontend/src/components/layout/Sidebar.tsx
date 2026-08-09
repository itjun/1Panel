import { useMemo, useState } from "react";
import { ChevronRight, Folder, Server, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useApp } from "@/store/app";

export function Sidebar() {
  const { groupNodes, selectedHost, selectHost, hosts } = useApp();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return groupNodes;
    const q = query.toLowerCase();
    return groupNodes
      .map((node) => ({
        ...node,
        hosts: node.hosts.filter(
          (h) =>
            h.name.toLowerCase().includes(q) ||
            (h.hostName || "").toLowerCase().includes(q)
        ),
      }))
      .filter((node) => node.hosts.length > 0);
  }, [groupNodes, query]);

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card/30">
      {/* 搜索 */}
      <div className="p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索主机..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      <ScrollArea className="flex-1 px-2 pb-3">
        <div className="space-y-0.5">
          {filtered.length === 0 && (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              {hosts.length === 0 ? "暂无主机" : "无匹配结果"}
            </div>
          )}
          {filtered.map((node) => {
            const id = node.group?.id ?? "__ungrouped__";
            const name = node.group?.name ?? "未分组";
            const isCollapsed = collapsed[id] === true;
            return (
              <div key={id}>
                <button
                  onClick={() =>
                    setCollapsed((c) => ({ ...c, [id]: !isCollapsed }))
                  }
                  className="group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent"
                >
                  <ChevronRight
                    className={cn(
                      "h-3 w-3 transition-transform",
                      !isCollapsed && "rotate-90"
                    )}
                  />
                  <Folder className="h-3 w-3" />
                  <span className="flex-1 text-left">{name}</span>
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {node.hosts.length}
                  </span>
                </button>
                {!isCollapsed && (
                  <div className="ml-3 mt-0.5 space-y-0.5 border-l border-border pl-2">
                    {node.hosts.map((h) => {
                      const active = selectedHost === h.name;
                      return (
                        <button
                          key={h.name}
                          onClick={() => selectHost(h.name)}
                          className={cn(
                            "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-all",
                            active
                              ? "bg-primary text-primary-foreground shadow-sm"
                              : "text-foreground/80 hover:bg-accent hover:text-accent-foreground"
                          )}
                        >
                          <Server
                            className={cn(
                              "h-3 w-3 shrink-0",
                              active ? "text-primary-foreground" : "text-muted-foreground"
                            )}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="truncate font-medium">{h.name}</div>
                            <div
                              className={cn(
                                "truncate text-[10px]",
                                active ? "text-primary-foreground/70" : "text-muted-foreground"
                              )}
                            >
                              {h.user || "?"}@{h.hostName || "?"}
                            </div>
                          </div>
                          {h.port && h.port !== "22" && (
                            <Badge
                              variant="outline"
                              className={cn(
                                "h-4 px-1 text-[9px]",
                                active ? "border-primary-foreground/30" : ""
                              )}
                            >
                              :{h.port}
                            </Badge>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>

      <div className="border-t border-border p-3">
        <div className="text-[10px] text-muted-foreground">
          共 {hosts.length} 台主机
        </div>
      </div>
    </aside>
  );
}
