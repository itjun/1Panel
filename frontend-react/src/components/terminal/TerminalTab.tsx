import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { EventsOn, EventsOff } from "@wailsjs/runtime/runtime";
import { api } from "@/lib/api";
import { useSettings } from "@/store/settings";
import { useApp } from "@/store/app";
import { Plus, X, SquareTerminal, Copy, ClipboardPaste } from "lucide-react";
import { cn } from "@/lib/utils";

interface TerminalTabProps {
  host: string;
}

interface SessionTab {
  id: string;
  sessionID: string;
  eventName: string;
  term: XTerm;
  fit: FitAddon;
  closed: boolean;
  el: HTMLDivElement;
}

interface CtxMenu {
  x: number;
  y: number;
  sessionID: string;
  term: XTerm;
  hasSelection: boolean;
}

let tabSeq = 0;

export function TerminalTab({ host }: TerminalTabProps) {
  const { settings } = useSettings();
  const { pendingTerminalCmd, clearTerminalCmd } = useApp();
  const [tabs, setTabs] = useState<SessionTab[]>([]);
  const [activeID, setActiveID] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<SessionTab[]>([]);
  tabsRef.current = tabs;
  const pendingCmdRef = useRef<string | null>(null);

  const termFontSize = Math.round(settings.fontSize * 1.05);
  const termFontFamily = settings.fontFamily.includes("Mono")
    ? settings.fontFamily
    : '"SF Mono", "JetBrains Mono", Menlo, Monaco, monospace';

  const openNew = async () => {
    const container = containerRef.current;
    if (!container) return;

    const id = `term-${Date.now()}-${tabSeq++}`;
    const eventName = `term:${id}`;

    const term = new XTerm({
      cursorBlink: true,
      fontSize: termFontSize,
      fontFamily: termFontFamily,
      // 允许选中文本用于复制
      rightClickSelectsWord: false,
      theme: {
        background: "#0a0a0a",
        foreground: "#e4e4e7",
        cursor: "#e4e4e7",
        selectionBackground: "#3f3f46",
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

    // 必须先挂到真实容器再 fit，否则行列为 0/错误 → 远程 PTY 开局出 ]]] 乱码
    const el = document.createElement("div");
    el.style.width = "100%";
    el.style.height = "100%";
    el.style.position = "absolute";
    el.style.inset = "0";
    // 清掉旧可见终端，先用本 el 测量尺寸
    container.innerHTML = "";
    container.appendChild(el);
    term.open(el);

    // 等一帧让布局生效再 fit
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    try {
      fit.fit();
    } catch {
      /* ignore */
    }
    let cols = term.cols || 80;
    let rows = term.rows || 24;
    if (cols < 20) cols = 80;
    if (rows < 5) rows = 24;

    let sessionID = "";
    try {
      sessionID = await api.openTerminal(host, eventName, cols, rows);
    } catch (e) {
      term.write(`\x1b[31m连接失败: ${e}\x1b[0m\r\n`);
    }

    if (sessionID) {
      // 再同步一次尺寸（挂载后可能略变）
      try {
        fit.fit();
        if (term.cols !== cols || term.rows !== rows) {
          await api.resizeTerminal(sessionID, term.cols, term.rows);
        }
      } catch {
        /* ignore */
      }
      term.onResize(({ cols: c, rows: r }) => {
        api.resizeTerminal(sessionID, c, r).catch(() => {});
      });
    }

    if (sessionID && pendingCmdRef.current) {
      const cmd = pendingCmdRef.current;
      pendingCmdRef.current = null;
      clearTerminalCmd();
      setTimeout(() => {
        api.writeTerminal(sessionID, cmd + "\n").catch(() => {});
      }, 1200);
    }

    EventsOn(eventName, (payload: { data?: string }) => {
      if (payload?.data) term.write(payload.data);
    });
    EventsOn(`${eventName}:exit`, () => {
      term.write("\r\n\x1b[33m[连接已关闭]\x1b[0m\r\n");
      setTabs((ts) =>
        ts.map((t) => (t.id === id ? { ...t, closed: true } : t))
      );
    });

    // 输入：合并普通按键，控制字符立即发
    const sessionIDRef = sessionID;
    let inputBuf = "";
    let flushScheduled = false;
    const flushInput = () => {
      flushScheduled = false;
      if (inputBuf && sessionIDRef) {
        api.writeTerminal(sessionIDRef, inputBuf).catch(() => {});
        inputBuf = "";
      }
    };
    term.onData((d) => {
      if (!sessionIDRef) return;
      inputBuf += d;
      if (!flushScheduled) {
        flushScheduled = true;
        if (d === "\r" || d === "\n" || d.charCodeAt(0) < 32) {
          flushInput();
        } else {
          setTimeout(flushInput, 0);
        }
      }
    });

    // 右键：自定义复制/粘贴菜单（拦截浏览器默认菜单）
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const sel = term.getSelection();
      setCtxMenu({
        x: e.clientX,
        y: e.clientY,
        sessionID: sessionIDRef,
        term,
        hasSelection: !!sel && sel.length > 0,
      });
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
    term.focus();
  };

  useEffect(() => {
    if (pendingTerminalCmd) {
      pendingCmdRef.current = pendingTerminalCmd;
    }
  }, [pendingTerminalCmd]);

  useEffect(() => {
    if (!pendingTerminalCmd || tabs.length === 0) return;
    const active = tabs.find((t) => t.id === activeID) || tabs[0];
    if (!active?.sessionID) return;
    const cmd = pendingTerminalCmd;
    clearTerminalCmd();
    pendingCmdRef.current = null;
    setTimeout(() => {
      api.writeTerminal(active.sessionID, cmd + "\n").catch(() => {});
    }, 300);
  }, [pendingTerminalCmd, tabs, activeID]);

  // 首次进入自动开一个
  useEffect(() => {
    // 等容器挂载后再开
    const t = window.setTimeout(() => {
      if (tabsRef.current.length === 0) {
        void openNew();
      }
    }, 50);
    return () => {
      clearTimeout(t);
      tabsRef.current.forEach((tab) => {
        if (tab.sessionID) api.closeTerminal(tab.sessionID);
        EventsOff(tab.eventName);
        EventsOff(`${tab.eventName}:exit`);
        tab.term.dispose();
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 切换 active tab：挂载对应 el
  useEffect(() => {
    if (!containerRef.current || !activeID) return;
    const container = containerRef.current;
    const active = tabs.find((t) => t.id === activeID);
    if (!active) return;

    // 只保留当前 active 的子节点
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
    container.appendChild(active.el);

    // 下一帧 fit，避免尺寸为 0
    requestAnimationFrame(() => {
      try {
        active.fit.fit();
        if (active.sessionID) {
          api
            .resizeTerminal(active.sessionID, active.term.cols, active.term.rows)
            .catch(() => {});
        }
      } catch {
        /* ignore */
      }
      active.term.focus();
    });

    const onResize = () => {
      try {
        active.fit.fit();
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [activeID, tabs]);

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

  // 点外面关闭右键菜单
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const timer = setTimeout(() => {
      window.addEventListener("click", close);
      window.addEventListener("contextmenu", close);
    }, 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [ctxMenu]);

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

  const copySelection = async (term: XTerm) => {
    const text = term.getSelection();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 降级：execCommand
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCtxMenu(null);
  };

  const pasteClipboard = async (sessionID: string, term: XTerm) => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        setCtxMenu(null);
        return;
      }
      if (sessionID) {
        await api.writeTerminal(sessionID, text);
      } else {
        term.paste(text);
      }
    } catch (e) {
      console.error("粘贴失败", e);
    }
    setCtxMenu(null);
    term.focus();
  };

  return (
    <div className="flex h-full flex-col">
      {/* Tab 条 */}
      <div className="mb-2 flex items-center gap-1 border-b border-border pb-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
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
          type="button"
          onClick={() => void openNew()}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          title="新开终端"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 终端容器：relative 供 absolute 子节点铺满 */}
      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden rounded-lg border border-border bg-[#0a0a0a]"
        style={{ userSelect: "text" }}
      />

      {/* 右键菜单：复制 / 粘贴 */}
      {ctxMenu && (
        <div
          className="fixed z-50 min-w-[140px] rounded-md border border-border bg-popover p-1 shadow-lg"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            type="button"
            disabled={!ctxMenu.hasSelection}
            className={cn(
              "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs",
              ctxMenu.hasSelection
                ? "hover:bg-accent"
                : "cursor-not-allowed text-muted-foreground/50"
            )}
            onClick={() => void copySelection(ctxMenu.term)}
          >
            <Copy className="h-3.5 w-3.5" />
            复制
            <span className="ml-auto text-[10px] text-muted-foreground">
              ⌘C
            </span>
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
            onClick={() =>
              void pasteClipboard(ctxMenu.sessionID, ctxMenu.term)
            }
          >
            <ClipboardPaste className="h-3.5 w-3.5" />
            粘贴
            <span className="ml-auto text-[10px] text-muted-foreground">
              ⌘V
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
