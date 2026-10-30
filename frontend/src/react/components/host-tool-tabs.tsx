import { ChevronDown } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Popup } from "@/react/components/ui/popup";
import { cn } from "@/react/lib/utils";
import { LOCAL_SECTIONS } from "@/react/pages/local";
import { HOST_TOOLS, useSession } from "@/react/state/session";
import { measuredToolIndices } from "@/utils/toolOverflow";

export function useIsHostWorkspace(): boolean {
  const session = useSession();
  return (
    !session.settingsOpen &&
    (session.workspace === "local" || (session.workspace === "remote" && !!session.activeHost))
  );
}

export function HostToolTabs() {
  const session = useSession();
  const frame = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const local = session.workspace === "local";
  const tools = local ? LOCAL_SECTIONS : HOST_TOOLS;
  const selected = local ? session.localSection : session.activeTool;
  const choose = (id: string) => {
    if (local) session.setLocalSection(id as typeof session.localSection);
    else session.setTool(id as typeof session.activeTool);
    setOpen(false);
    requestAnimationFrame(() => frame.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus());
  };
  const anchor = useRef<HTMLButtonElement>(null);
  const [size, setSize] = useState({available: 0, widths: [] as number[], more: 76});
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const focusLast = useRef(false);
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      const buttons =
        menu.current?.querySelectorAll<HTMLButtonElement>("button");
      buttons?.[focusLast.current ? buttons.length - 1 : 0]?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);
  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => {
      if (!measureRef.current) return;
      setSize({available: el.clientWidth, widths: [...measureRef.current.querySelectorAll<HTMLElement>('[data-tool-size]')].map(node => node.getBoundingClientRect().width), more: measureRef.current.querySelector<HTMLElement>('[data-more-size]')?.getBoundingClientRect().width || 76});
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el); if (measureRef.current) observer.observe(measureRef.current);
    return () => observer.disconnect();
  }, [local]);
  const visible = size.widths.length === tools.length ? measuredToolIndices(size.widths, size.available, tools.findIndex(tool => tool.id === selected), size.more) : [Math.max(0, tools.findIndex(tool => tool.id === selected))];
  const hidden = tools.filter((_, i) => !visible.includes(i));
  useEffect(() => {
    if (!hidden.length) setOpen(false);
  }, [hidden.length]);
  useEffect(() => setOpen(false), [session.activeHost, local, selected]);
  return (
    <div ref={frame} className="workbench-tabs">
      <div
        role="tablist"
        aria-label={local ? "本机功能" : "主机功能"}
        className="flex min-w-0 items-stretch"
      >
        {visible.map((i) => {
          const tool = tools[i];
          return (
            <button
              key={tool.id}
              type="button"
              role="tab"
              aria-selected={selected === tool.id}
              tabIndex={selected === tool.id ? 0 : -1}
              className={cn(
                "workbench-tab",
                selected === tool.id && "is-active",
              )}
              onClick={() => {
                choose(tool.id);
              }}
              onKeyDown={(e) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
                  return;
                e.preventDefault();
                const position = visible.indexOf(i);
                const next =
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? visible.length - 1
                      : (position +
                          (e.key === "ArrowRight" ? 1 : -1) +
                          visible.length) %
                        visible.length;
                const target = tools[visible[next]];
                choose(target.id);
                (
                  e.currentTarget.parentElement?.children[next] as HTMLElement
                )?.focus();
              }}
            >
              {tool.label}
            </button>
          );
        })}
      </div>
      {!!hidden.length && (
        <button
          ref={anchor}
          type="button"
          className="workbench-more"
          aria-label={local ? "更多本机工具" : "更多主机工具"}
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => {
            focusLast.current = false;
            setOpen(!open);
          }}
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            focusLast.current = e.key === "ArrowUp";
            setOpen(true);
          }}
        >
          更多
          <ChevronDown size={14} />
        </button>
      )}
      <Popup
        open={open && !!hidden.length}
        anchorRef={anchor}
        onClose={() => setOpen(false)}
        className="min-w-40 p-1"
      >
        <div
          ref={menu}
          role="menu"
          aria-label={local ? "更多本机工具" : "更多主机工具"}
          onKeyDown={(e) => {
            if (e.key === "Tab") {
              setOpen(false);
              anchor.current?.focus();
              return;
            }
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key))
              return;
            e.preventDefault();
            const nodes = Array.from(
              e.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
            );
            const current = nodes.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const next =
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? nodes.length - 1
                  : (current +
                      (e.key === "ArrowDown" ? 1 : -1) +
                      nodes.length) %
                    nodes.length;
            nodes[next]?.focus();
          }}
        >
          {hidden.map((tool) => (
            <button
              type="button"
              role="menuitem"
              key={tool.id}
              className="flex h-8 w-full items-center rounded-control px-3 text-left text-sm hover:bg-raised focus-visible:bg-accent-soft"
              onClick={() => {
                choose(tool.id);
                requestAnimationFrame(() =>
                  frame.current
                    ?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
                    ?.focus(),
                );
              }}
            >
              {tool.label}
            </button>
          ))}
        </div>
      </Popup>
      <div ref={measureRef} className="workbench-tab-measure" aria-hidden="true">
        {tools.map(tool => <span data-tool-size className="workbench-tab" key={tool.id}>{tool.label}</span>)}
        <span data-more-size className="workbench-more">更多<ChevronDown size={14}/></span>
      </div>
    </div>
  );
}
