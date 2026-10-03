/**
 * ModuleRail — 一级图标栏（DESIGN.md §4.1 / §8.2）：72px 通顶，图标 + 下方小字，设置置底。
 */

import { Events } from "@wailsio/runtime";
import {
  Bell,
  FileCog,
  Gauge,
  Laptop,
  ScanSearch,
  Server,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/api";
import appMenuLogoUrl from "@/assets/1panel-menu-logo.svg";
import { Tag } from "@/react/components/ui/tag";
import { detectAppOs } from "@/react/lib/platform";
import { useSession } from "@/react/state/session";

function formatCount(n: number): string {
  return n > 99 ? "99+" : String(n);
}

export function ModuleRail() {
  const session = useSession();
  const isMac = detectAppOs() === "mac";
  const [unread, setUnread] = useState(0);
  const [configNeedsAttention, setConfigNeedsAttention] = useState(false);

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
    <aside className="module-rail flex h-full shrink-0 flex-col items-center" aria-label="一级功能">
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
        <RailModule icon={Server} label="主机" active={open && ws === "remote"} onClick={() => session.goHome()} />
        <RailModule icon={Laptop} label="本机" active={open && ws === "local"} onClick={() => session.setWorkspace("local")} />
        <RailModule
          icon={Bell}
          label="通知"
          active={open && ws === "notify"}
          badge={unread > 0 ? formatCount(unread) : null}
          onClick={() => session.setWorkspace("notify")}
        />
        <RailModule icon={Gauge} label="测速" active={open && ws === "speedtest"} onClick={() => session.setWorkspace("speedtest")} />
        <div className="flex-1" />
        <RailModule icon={ScanSearch} label="巡检" active={open && ws === "inspect"} onClick={() => session.setWorkspace("inspect")} />
        <RailModule
          icon={FileCog}
          label="配置"
          active={open && ws === "config"}
          statusDot={configNeedsAttention}
          onClick={() => session.setWorkspace("config")}
        />
        <RailModule icon={Settings} label="设置" active={session.settingsOpen} onClick={() => session.openSettings(true)} />
      </nav>
    </aside>
  );
}

function RailModule({
  icon: Icon,
  label,
  active,
  badge,
  statusDot,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  badge?: string | null;
  statusDot?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      className="module-rail-item shrink-0"
      onClick={onClick}
    >
      <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
      <span className="max-w-full truncate px-1">{label}</span>
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
