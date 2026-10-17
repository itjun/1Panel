import { ChevronDown } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Popup } from "@/react/components/ui/popup";
import { cn } from "@/react/lib/utils";
import { HOST_TOOLS, useSession } from "@/react/state/session";
import { visibleToolIndices } from "@/utils/toolOverflow";

export function useIsHostWorkspace(): boolean {
  const session = useSession();
  return (
    !session.settingsOpen &&
    session.workspace === "remote" &&
    !!session.activeHost
  );
}

export function HostToolTabs() {
  const session = useSession();
  const frame = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const [width, setWidth] = useState(0);
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
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const visible = visibleToolIndices(
    HOST_TOOLS.length,
    width,
    HOST_TOOLS.findIndex((t) => t.id === session.activeTool),
  );
  const hidden = HOST_TOOLS.filter((_, i) => !visible.includes(i));
  useEffect(() => {
    if (!hidden.length) setOpen(false);
  }, [hidden.length]);
  return (
    <div ref={frame} className="workbench-tabs">
      <div
        role="tablist"
        aria-label="主机功能"
        className="flex min-w-0 items-stretch"
      >
        {visible.map((i) => {
          const tool = HOST_TOOLS[i];
          return (
            <button
              key={tool.id}
              type="button"
              role="tab"
              aria-selected={session.activeTool === tool.id}
              tabIndex={session.activeTool === tool.id ? 0 : -1}
              className={cn(
                "workbench-tab",
                session.activeTool === tool.id && "is-active",
              )}
              onClick={() => {
                setOpen(false);
                session.setTool(tool.id);
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
                const target = HOST_TOOLS[visible[next]];
                session.setTool(target.id);
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
          aria-label="更多主机工具"
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
          aria-label="更多主机工具"
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
                session.setTool(tool.id);
                setOpen(false);
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
    </div>
  );
}
