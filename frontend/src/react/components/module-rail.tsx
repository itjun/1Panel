/**
 * ModuleRail — 一级图标栏（DESIGN.md §4.1 / §8.2）：72px 通顶，图标 + 下方小字，设置置底。
 */

import { Events } from "@wailsio/runtime";
import {
  Bell,
  FileCog,
  Laptop,
  ScanSearch,
  Server,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "@/api";
import appMenuLogoUrl from "@/assets/1panel-menu-logo.svg";
import { Tag } from "@/react/components/ui/tag";
import { MOTION_MS, usePresence } from "@/react/lib/motion";
import { detectAppOs } from "@/react/lib/platform";
import { useSession } from "@/react/state/session";

const RAIL_LABELS_KEY = "1pannel-rail-labels";

function formatCount(n: number): string {
  return n > 99 ? "99+" : String(n);
}

function loadShowLabels(): boolean {
  try {
    return localStorage.getItem(RAIL_LABELS_KEY) !== "0";
  } catch {
    return true;
  }
}

function saveShowLabels(show: boolean) {
  try {
    localStorage.setItem(RAIL_LABELS_KEY, show ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function ModuleRail() {
  const session = useSession();
  const isMac = detectAppOs() === "mac";
  const [unread, setUnread] = useState(0);
  const [configNeedsAttention, setConfigNeedsAttention] = useState(false);
  const [showLabels, setShowLabels] = useState(loadShowLabels);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  function toggleLabels() {
    setShowLabels((prev) => {
      const next = !prev;
      saveShowLabels(next);
      return next;
    });
  }

  // 通知未读数
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const n = await api.unreadAlertCount();
        if (!cancelled) setUnread(Number(n) || 0);
      } catch {
        /* 轮询失败时保持上次数字 */
      }
    }
    void tick();
    const timer = window.setInterval(() => void tick(), 15000);
    const onChanged = () => void tick();
    window.addEventListener("alerts-changed", onChanged);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("alerts-changed", onChanged);
    };
  }, []);

  // 配置红点
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const overview = await api.getPanelConfigOverview();
        if (cancelled) return;
        setConfigNeedsAttention(
          !!(overview.configStale || overview.drift || overview.needsReview),
        );
      } catch {
        /* 打开配置工作区时再报错 */
      }
    }
    void refresh();
    const offs = [
      Events.On("panel-config-imported", () => void refresh()),
      Events.On("panel-config-needs-review", () => setConfigNeedsAttention(true)),
      Events.On("panel-config-import-error", () => setConfigNeedsAttention(true)),
    ];
    return () => {
      cancelled = true;
      offs.forEach((off) => off());
    };
  }, []);

  const open = !session.settingsOpen;
  const ws = session.workspace;

  return (
    <aside
      className="module-rail flex h-full shrink-0 flex-col items-center"
      data-labels={showLabels ? "on" : "off"}
      aria-label="一级功能"
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {/* 顶部 40px 是窗口拖拽区：Mac 放系统红绿灯，Win/Linux 放应用图标 */}
      <div className="module-rail-drag drag-region flex h-10 w-full shrink-0 items-center justify-center">
        {isMac ? null : (
          <img
            src={appMenuLogoUrl}
            alt=""
            width={18}
            height={18}
            draggable={false}
            className="size-[18px] select-none"
            aria-hidden="true"
          />
        )}
      </div>
      <nav className="flex min-h-0 w-full flex-1 flex-col items-center gap-1 pb-2" aria-label="切换模块">
        <RailModule icon={Server} label="主机" showLabel={showLabels} active={open && ws === "remote"} onClick={() => session.goHome()} />
        <RailModule icon={Laptop} label="本机" showLabel={showLabels} active={open && ws === "local"} onClick={() => session.setWorkspace("local")} />
        <RailModule
          icon={Bell}
          label="通知"
          showLabel={showLabels}
          active={open && ws === "notify"}
          badge={unread > 0 ? formatCount(unread) : null}
          onClick={() => session.setWorkspace("notify")}
        />
        <div className="flex-1" />
        <RailModule icon={ScanSearch} label="巡检" showLabel={showLabels} active={open && ws === "inspect"} onClick={() => session.setWorkspace("inspect")} />
        <RailModule
          icon={FileCog}
          label="配置"
          showLabel={showLabels}
          active={open && ws === "config"}
          statusDot={configNeedsAttention}
          onClick={() => session.setWorkspace("config")}
        />
        <RailModule icon={Settings} label="设置" showLabel={showLabels} active={session.settingsOpen} onClick={() => session.openSettings(true)} />
      </nav>
      <RailMenu
        menu={menu}
        showLabels={showLabels}
        onClose={() => setMenu(null)}
        onToggleLabels={toggleLabels}
      />
    </aside>
  );
}

function RailModule({
  icon: Icon,
  label,
  showLabel,
  active,
  badge,
  statusDot,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  showLabel: boolean;
  active: boolean;
  badge?: string | null;
  statusDot?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      aria-label={showLabel ? undefined : label}
      data-tip={showLabel ? undefined : label}
      className="module-rail-item shrink-0"
      onClick={onClick}
    >
      <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
      {showLabel ? <span className="max-w-full truncate px-1">{label}</span> : null}
      {badge ? (
        <Tag tone="accent" className="module-rail-badge absolute h-4 px-1 font-mono tabular-nums">
          {badge}
        </Tag>
      ) : null}
      {statusDot ? (
        <span className="module-rail-dot absolute h-1.5 w-1.5 rounded-full bg-danger" />
      ) : null}
    </button>
  );
}

/** 图标栏右键菜单：切换显示 / 隐藏名称，样式与侧栏主机右键菜单一致 */
function RailMenu({
  menu,
  showLabels,
  onClose,
  onToggleLabels,
}: {
  menu: { x: number; y: number } | null;
  showLabels: boolean;
  onClose: () => void;
  onToggleLabels: () => void;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const lastMenuRef = useRef(menu);
  if (menu) lastMenuRef.current = menu;
  const { mounted, visible } = usePresence(!!menu, MOTION_MS.moderate);
  const active = menu ?? lastMenuRef.current;

  useLayoutEffect(() => {
    if (!active || !elRef.current) return;
    // 入场动画带 scale，getBoundingClientRect 会量小；offset 尺寸不受 transform 影响
    const width = elRef.current.offsetWidth;
    const height = elRef.current.offsetHeight;
    const x = Math.max(8, Math.min(active.x, window.innerWidth - width - 8));
    const y = Math.max(8, Math.min(active.y, window.innerHeight - height - 8));
    elRef.current.style.left = `${x}px`;
    elRef.current.style.top = `${y}px`;
  }, [active, mounted]);

  useEffect(() => {
    if (!menu) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, onClose]);

  if (!mounted || !active) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[60]"
        onMouseDown={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
      />
      <div
        ref={elRef}
        role="menu"
        className="motion-menu-panel fixed z-[61] min-w-[160px] rounded-panel border border-line bg-surface py-1 text-sm text-ink"
        data-open={visible ? "true" : "false"}
        style={{ left: active.x, top: active.y }}
        onMouseDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <button
          type="button"
          role="menuitem"
          className="flex h-8 w-full items-center px-3 text-left text-ink hover:bg-raised"
          onClick={() => {
            onClose();
            onToggleLabels();
          }}
        >
          {showLabels ? "隐藏名称" : "显示名称"}
        </button>
      </div>
    </>
  );
}
