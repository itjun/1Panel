import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { EventsOn, EventsOff } from "@wailsjs/runtime/runtime";
import { api } from "@/lib/api";
import { Plus, X, SquareTerminal } from "lucide-react";
import { cn } from "@/lib/utils";

interface TerminalTabProps {
  host: string;
}

interface SessionTab {
  id: string;        // 前端 Tab ID
  sessionID: string; // 后端会话 ID
  eventName: string; // 后端事件名
  term: XTerm;
  fit: FitAddon;
  closed: boolean;
}

let tabSeq = 0;

export function TerminalTab({ host }: TerminalTabProps) {
  const [tabs, setTabs] = useState<SessionTab[]>([]);
  const [activeID, setActiveID] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const openNew = async () => {
    const id = `term-${Date.now()}-${tabSeq++}`;
    const eventName = `term:${id}`;

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily:
        "'JetBrains Mono', 'SF Mono', 'Menlo', 'Consolas', monospace",
      theme: {
        background: "#0a0a0a",
        foreground: "#e4e4e7",
        cursor: "#e4e4e7",
        selectionBackground: "#27272a",
        black: "#0a0a0a",
        red: "#ef4444",
        green: "#22c55e",
        yellow: "#eab308",
        blue: "#3b82f6",
        magenta: "#a855f7",
        cyan: "#06b6d4",
        white: "#e4e4e7",
        brightBlack: "#52525b",
        brightRed: "#f87171",
        brightGreen: "#4ade80",
        brightYellow: "#facc15",
        brightBlue: "#60a5fa",
        brightMagenta: "#c084fc",
        brightCyan: "#22d3ee",
        brightWhite: "#fafafa",
      },
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());

    // 先建立会话
    let sessionID: string = "";
    try {
      sessionID = await api.openTerminal(host, eventName);
    } catch (e) {
      term.write(`\x1b[31m连接失败: ${e}\x1b[0m\r\n`);
    }
    // 把 sessionID 装入 tab 结构（即使失败也保留以便展示错误）
    const tab: SessionTab = {
      id,
      sessionID: sessionID || "",
      eventName,
      term,
      fit,
      closed: false,
    };

    // 把 term 挂到一个隐藏 div，等切到 active 再 attach 到主容器
    const holder = document.createElement("div");
    holder.style.position = "absolute";
    holder.style.left = "-9999px";
    holder.style.width = "100%";
    holder.style.height = "100%";
    document.body.appendChild(holder);
    term.open(holder);
    fit.fit();

    // 监听后端输出
    EventsOn(eventName, (payload: { data?: string }) => {
      if (payload?.data) term.write(payload.data);
    });
    EventsOn(`${eventName}:exit`, () => {
      term.write("\r\n\x1b[33m[连接已关闭]\x1b[0m\r\n");
      setTabs((ts) =>
        ts.map((t) => (t.id === id ? { ...t, closed: true } : t))
      );
    });

    // 用户输入转发给后端
    term.onData((d) => {
      if (tab.sessionID) {
        api.writeTerminal(tab.sessionID, d);
      }
    });

    setTabs((ts) => [...ts, tab]);
    setActiveID(id);
  };

  // 首次进入自动开一个
  useEffect(() => {
    if (tabs.length === 0) {
      openNew();
    }
    return () => {
      // 组件卸载时关掉所有会话
      tabs.forEach((t) => {
        if (t.sessionID) api.closeTerminal(t.sessionID);
        EventsOff(t.eventName);
        EventsOff(`${t.eventName}:exit`);
        t.term.dispose();
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 切换 active tab 时把对应 term detach/attach 到容器
  useEffect(() => {
    if (!containerRef.current || !activeID) return;
    const active = tabs.find((t) => t.id === activeID);
    if (!active) return;
    // 清空容器
    containerRef.current.innerHTML = "";
    // 重建一个子 div 给 xterm
    const inner = document.createElement("div");
    inner.style.width = "100%";
    inner.style.height = "100%";
    containerRef.current.appendChild(inner);
    active.term.open(inner);
    active.fit.fit();
    active.term.focus();
    // 重新挂监听 resize
    const onResize = () => active.fit.fit();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [activeID, tabs]);

  const close = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const t = tabs.find((x) => x.id === id);
    if (!t) return;
    if (t.sessionID) await api.closeTerminal(t.sessionID);
    EventsOff(t.eventName);
    EventsOff(`${t.eventName}:exit`);
    t.term.dispose();
    const next = tabs.filter((x) => x.id !== id);
    setTabs(next);
    if (activeID === id) {
      setActiveID(next.length ? next[next.length - 1].id : null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Tab 条 */}
      <div className="mb-2 flex items-center gap-1 border-b border-border pb-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveID(t.id)}
            className={cn(
              "group flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors",
              activeID === t.id
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-accent"
            )}
          >
            <SquareTerminal className="h-3 w-3" />
            <span>
              {host}#{t.id.split("-").slice(-1)}
            </span>
            {t.closed && (
              <span className="text-[9px] text-warning">已断开</span>
            )}
            <span
              role="button"
              onClick={(e) => close(t.id, e)}
              className="ml-1 rounded p-0.5 opacity-0 transition-opacity hover:bg-background group-hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </span>
          </button>
        ))}
        <button
          onClick={openNew}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          title="新开终端"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 终端容器 */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden rounded-lg border border-border bg-[#0a0a0a] p-1"
        style={{ userSelect: "text" }}
      />
    </div>
  );
}
