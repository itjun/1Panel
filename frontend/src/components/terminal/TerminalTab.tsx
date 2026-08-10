import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { EventsOn, EventsOff } from "@wailsjs/runtime/runtime";
import { api } from "@/lib/api";
import { useSettings } from "@/store/settings";
import { Plus, X, SquareTerminal } from "lucide-react";
import { cn } from "@/lib/utils";

interface TerminalTabProps {
  host: string;
}

interface SessionTab {
  id: string;          // 前端 Tab ID
  sessionID: string;   // 后端会话 ID
  eventName: string;   // 后端事件名
  term: XTerm;
  fit: FitAddon;
  closed: boolean;
  // term.open() 的目标 DOM 节点；切换 active 时把这个节点 detach/attach
  el: HTMLDivElement;
}

let tabSeq = 0;

export function TerminalTab({ host }: TerminalTabProps) {
  const { settings } = useSettings();
  const [tabs, setTabs] = useState<SessionTab[]>([]);
  const [activeID, setActiveID] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 终端字体随设置变化
  const termFontSize = Math.round(settings.fontSize * 1.05); // 略大一点便于阅读
  const termFontFamily = settings.fontFamily.includes("Mono")
    ? settings.fontFamily
    : '"SF Mono", "JetBrains Mono", Menlo, Monaco, monospace';

  const openNew = async () => {
    const id = `term-${Date.now()}-${tabSeq++}`;
    const eventName = `term:${id}`;

    // 创建 term 实例，主题色固定深色（终端永远是深色更舒服）
    const term = new XTerm({
      cursorBlink: true,
      fontSize: termFontSize,
      fontFamily: termFontFamily,
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

    // 关键：先创建持久 DOM 节点，并一次性 open（绝不再 open 第二次）
    const el = document.createElement("div");
    el.style.width = "100%";
    el.style.height = "100%";
    term.open(el);
    fit.fit();

    // 先建立后端会话
    let sessionID = "";
    try {
      sessionID = await api.openTerminal(host, eventName);
    } catch (e) {
      term.write(`\x1b[31m连接失败: ${e}\x1b[0m\r\n`);
    }

    // 会话建立后，把当前 cols/rows 同步给后端 PTY，并注册 onResize 持续同步
    if (sessionID) {
      api.resizeTerminal(sessionID, term.cols, term.rows).catch(() => {});
      term.onResize(() => {
        api
          .resizeTerminal(sessionID, term.cols, term.rows)
          .catch(() => {});
      });
    }

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
    // 优化：xterm onData 每次按键触发一次，如果每次都走 Wails IPC 会有明显延迟
    //（每字符一次 JSON 序列化 + 消息往返）。用缓冲区把连续按键合并，
    // 用 setTimeout(0) 在下一个事件循环一次性发送，大幅减少 IPC 次数
    const sessionIDRef = sessionID;
    let inputBuf = "";
    let flushScheduled = false;
    const flushInput = () => {
      flushScheduled = false;
      if (inputBuf && sessionIDRef) {
        // fire-and-forget：不 await，避免阻塞下一个按键
        api.writeTerminal(sessionIDRef, inputBuf).catch(() => {});
        inputBuf = "";
      }
    };
    term.onData((d) => {
      if (!sessionIDRef) return;
      inputBuf += d;
      if (!flushScheduled) {
        flushScheduled = true;
        // 回车/换行/控制字符立刻发送，不等待合并（保证命令及时执行）
        if (d === "\r" || d === "\n" || d.charCodeAt(0) < 32) {
          flushInput();
        } else {
          setTimeout(flushInput, 0);
        }
      }
    });

    const tab: SessionTab = {
      id,
      sessionID,
      eventName,
      term,
      fit,
      closed: false,
      el,
    };

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

  // 切换 active tab：把对应 el 挂到容器，其它的 detach
  useEffect(() => {
    if (!containerRef.current || !activeID) return;
    const container = containerRef.current;
    // 清空容器
    container.innerHTML = "";
    const active = tabs.find((t) => t.id === activeID);
    if (!active) return;
    // 重新挂当前 active 的 el（注意：xterm 的 textarea 会一起跟着走，不丢焦点）
    container.appendChild(active.el);
    active.fit.fit();
    active.term.focus();
    const onResize = () => active.fit.fit();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [activeID, tabs]);

  // 字号/字体变化时，更新所有 term
  useEffect(() => {
    tabs.forEach((t) => {
      t.term.options.fontSize = termFontSize;
      t.term.options.fontFamily = termFontFamily;
      try {
        t.fit.fit();
      } catch {
        /* ignore */
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termFontSize, termFontFamily]);

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
