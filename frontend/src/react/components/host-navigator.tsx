import { Search, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { DistroBadge } from "./distro-badge";
import { cn } from "@/react/lib/utils";
import { detectAppOs } from "@/react/lib/platform";
import { filterHostChoices, hostShortcut, stepHostChoice } from "@/react/lib/host-shortcuts";
import { captureHostPreview, type HostPreview } from "@/react/lib/host-preview";
import { HOST_TOOLS, useSession } from "@/react/state/session";
import "@/react/styles/host-navigator.css";

type Picker = { mode: "open" | "switch"; selected: string } | null;

function Preview({ preview }: { preview: HostPreview }) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = frame.current!;
    const observer = new ResizeObserver(() => setWidth(node.clientWidth));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <div ref={frame} className="host-switch-preview" aria-hidden="true">
    <iframe title="主机页面缩略图" sandbox="" tabIndex={-1} srcDoc={preview.html}
      style={{ width: preview.width, height: preview.height, transform: `scale(${width / preview.width})` }} />
  </div>;
}

export function HostNavigator({ onReload }: { onReload: () => void }) {
  const session = useSession();
  const [picker, setPicker] = useState<Picker>(null);
  const pickerRef = useRef<Picker>(null);
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const previews = useRef(new Map<string, HostPreview>());
  const listId = useId();
  const choices = useMemo(() => session.orderedHosts.map((host) => ({
    name: host.name,
    group: session.groupName(session.groupIdOf(host.name)) || "未分组",
    tool: session.openedHosts.find((item) => item.name === host.name)?.tool || "overview" as const,
    isOpened: session.openedHosts.some((item) => item.name === host.name),
  })), [session]);
  const opened = useMemo(() => session.openedHosts.flatMap((item) => {
    const choice = choices.find((host) => host.name === item.name);
    return choice ? [choice] : [];
  }), [choices, session.openedHosts]);
  const items = picker?.mode === "switch" ? opened : filterHostChoices(choices, query);
  const selected = items.find((item) => item.name === picker?.selected) || items[0];
  const current = useRef({ session, choices, opened, onReload, items });
  current.current = { session, choices, opened, onReload, items };

  const changePicker = useCallback((next: Picker) => {
    pickerRef.current = next;
    setPicker(next);
  }, []);
  const close = useCallback(() => changePicker(null), [changePicker]);
  const choose = useCallback((name: string) => {
    close();
    current.current.session.openHost(name);
  }, [close]);
  const savePreview = useCallback(() => {
    const state = current.current.session;
    if (state.workspace !== "remote" || state.settingsOpen || !state.activeHost) return;
    const root = document.querySelector<HTMLElement>(".react-root[data-os]");
    if (!root) return;
    const preview = captureHostPreview(root, state.activeTool);
    if (preview) previews.current.set(state.activeHost, preview);
  }, []);

  useEffect(() => {
    const names = new Set(session.openedHosts.map((host) => host.name));
    for (const name of previews.current.keys()) if (!names.has(name)) previews.current.delete(name);
  }, [session.openedHosts]);

  useEffect(() => {
    if (session.workspace !== "remote" || session.settingsOpen || !session.activeHost) return;
    const root = document.querySelector<HTMLElement>(".react-root[data-os]");
    if (!root) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (timer) return;
      timer = setTimeout(() => { timer = undefined; savePreview(); }, 500);
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, [session.workspace, session.settingsOpen, session.activeHost, session.activeTool, savePreview]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = hostShortcut(event, detectAppOs());
      if (action) {
        event.preventDefault();
        event.stopPropagation();
        if (action === "reload") {
          if (!event.repeat) { close(); current.current.onReload(); }
        } else if (action === "open") {
          if (event.repeat) return;
          if (!pickerRef.current) previousFocus.current = document.activeElement as HTMLElement;
          setQuery("");
          changePicker({ mode: "open", selected: current.current.session.activeHost });
          requestAnimationFrame(() => input.current?.focus());
        } else {
          const hosts = current.current.opened;
          if (!hosts.length) return;
          const active = pickerRef.current;
          if (!active) {
            previousFocus.current = document.activeElement as HTMLElement;
            savePreview();
          }
          const from = active?.mode === "switch" ? active.selected : current.current.session.workspace === "remote" && !current.current.session.settingsOpen ? current.current.session.activeHost : "";
          changePicker({ mode: "switch", selected: stepHostChoice(hosts, from, action === "previous" ? -1 : 1) });
        }
        return;
      }
      const active = pickerRef.current;
      if (!active || event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); close();
      } else if (event.key === "Enter") {
        if (event.target instanceof Element && event.target.closest("button")) return;
        event.preventDefault(); event.stopPropagation();
        const target = current.current.items.find((item) => item.name === active.selected) || current.current.items[0];
        if (target) choose(target.name);
      } else if (["ArrowDown", "ArrowUp", ...(active.mode === "switch" ? ["ArrowLeft", "ArrowRight", "Home", "End"] : [])].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const hosts = current.current.items;
        const columns = list.current ? getComputedStyle(list.current).gridTemplateColumns.split(" ").length : 3;
        let step = event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 1;
        if (active.mode === "switch" && (event.key === "ArrowUp" || event.key === "ArrowDown")) step *= columns;
        const name = event.key === "Home" ? hosts[0]?.name : event.key === "End" ? hosts[hosts.length - 1]?.name : stepHostChoice(hosts, active.selected, step);
        if (name) changePicker({ ...active, selected: name });
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const active = pickerRef.current;
      if (active?.mode !== "switch" || event.key !== "Control") return;
      event.preventDefault(); event.stopPropagation();
      if (current.current.opened.some((host) => host.name === active.selected)) choose(active.selected);
      else close();
    };
    const onVisibility = () => { if (document.hidden) close(); };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", close);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", close);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [changePicker, choose, close, savePreview]);

  useEffect(() => {
    if (!picker) return;
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [picker?.selected, query]);

  return <Dialog open={!!picker} onOpenChange={(isOpen) => { if (!isOpen) close(); }}>
    <DialogContent className={cn("host-navigator", picker?.mode === "switch" ? "host-navigator-switch" : "host-navigator-open")}
      aria-describedby={undefined}
      onOpenAutoFocus={(event) => { event.preventDefault(); if (pickerRef.current?.mode === "open") input.current?.focus(); else list.current?.focus(); }}
      onCloseAutoFocus={(event) => { event.preventDefault(); if (previousFocus.current?.isConnected) previousFocus.current.focus(); }}>
      <div className="mb-5 flex shrink-0 items-center justify-between gap-4">
        <DialogTitle>{picker?.mode === "switch" ? "切换主机" : "打开远程主机"}</DialogTitle>
        <button type="button" aria-label="关闭" className="grid h-7 w-7 place-items-center rounded-control text-muted hover:bg-raised hover:text-ink" onClick={close}><X size={16} /></button>
      </div>
      {picker?.mode === "open" ? <div className="host-open-search mb-4 flex shrink-0 items-center gap-2 rounded-control border border-line-strong px-3 focus-within:border-accent">
        <Search size={17} className="shrink-0 text-muted" />
        <input ref={input} role="combobox" aria-label="搜索主机名称或分组" placeholder="搜索主机名称或分组"
          aria-autocomplete="list" aria-expanded aria-controls={listId} aria-activedescendant={selected ? `${listId}-${items.indexOf(selected)}` : undefined}
          value={query} onChange={(event) => {
            setQuery(event.target.value);
            const first = filterHostChoices(choices, event.target.value)[0];
            changePicker({ mode: "open", selected: first?.name || "" });
          }} className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted" />
      </div> : null}
      <div ref={list} id={listId} role="listbox" aria-label={picker?.mode === "switch" ? "已打开的主机" : "远程主机"}
        aria-activedescendant={selected ? `${listId}-${items.indexOf(selected)}` : undefined}
        tabIndex={picker?.mode === "switch" ? 0 : -1} className={cn("host-navigator-items outline-none", picker?.mode === "switch" && "host-switch-grid")}>
        {items.map((host, index) => {
          const isSelected = selected?.name === host.name;
          const tool = HOST_TOOLS.find((item) => item.id === host.tool)?.label;
          const preview = previews.current.get(host.name);
          return <div key={host.name} id={`${listId}-${index}`} role="option" aria-label={`${host.name} ${host.group} ${tool}`} aria-selected={isSelected}
            className={cn("host-navigator-option", picker?.mode === "switch" ? "host-switch-card" : "host-open-row", isSelected && "is-selected")}
            onClick={() => choose(host.name)} onPointerMove={(event) => {
              if ((event.movementX || event.movementY) && !isSelected && picker) changePicker({ ...picker, selected: host.name });
            }}>
            {picker?.mode === "switch" ? <>
              {preview && preview.tool === host.tool ? <Preview preview={preview} /> : <div className="host-switch-preview flex flex-col items-center justify-center gap-2 text-muted"><DistroBadge boxSize={40} osRelease={session.osRelease[host.name]} isTooltipEnabled={false} /><span className="text-sm">{tool}</span></div>}
              <div className="mt-2 flex min-w-0 items-center justify-between gap-2 px-1"><span className="truncate font-semibold">{host.name}</span><span className="shrink-0 text-xs text-muted">{tool}</span></div>
              <div className="mt-1 truncate px-1 text-xs text-muted">{host.group}</div>
            </> : <>
              <DistroBadge boxSize={22} osRelease={session.osRelease[host.name]} isTooltipEnabled={false} />
              <span className="host-open-name min-w-0 truncate font-medium">{host.name}</span>
              <span className="host-open-group truncate text-muted">{host.group}</span>
              <span className="w-12 shrink-0 text-right text-muted">{tool}</span>
              <span className="w-14 shrink-0 text-right text-xs text-muted">{host.isOpened ? "已打开" : ""}</span>
            </>}
          </div>;
        })}
        {!items.length ? <div role="status" className="py-10 text-center text-sm text-muted">{session.loading ? "正在加载主机…" : query ? "没有匹配的主机" : picker?.mode === "switch" ? "尚未打开主机" : "尚未添加远程主机"}</div> : null}
      </div>
    </DialogContent>
  </Dialog>;
}
