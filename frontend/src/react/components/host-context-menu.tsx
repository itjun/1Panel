import { useEffect, useLayoutEffect, useRef } from "react";
import { MOTION_MS, usePresence } from "@/react/lib/motion";
import { cn } from "@/react/lib/utils";
import { useSession } from "@/react/state/session";

export type HostContextMenuState = {
  host: string;
  hosts: string[];
  x: number;
  y: number;
};

/**
 * 侧栏主机右键菜单：只放主机操作，功能切换走主机页顶部的标签条（HostToolTabs）。
 * 单选和多选结构一样，多选时只能对单台生效的项置灰。
 */
type Props = {
  menu: HostContextMenuState | null;
  pinned: string[];
  onClose: () => void;
  onOpenInTerminal: (hosts: string[]) => void;
  onTogglePin: (host: string) => void;
  onEdit: (host: string) => void;
  onDisconnect: (hosts: string[]) => void;
};

export function HostContextMenu({
  menu,
  pinned,
  onClose,
  onOpenInTerminal,
  onTogglePin,
  onEdit,
  onDisconnect,
}: Props) {
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
    const maxX = window.innerWidth - width - 8;
    const maxY = window.innerHeight - height - 8;
    const x = Math.max(8, Math.min(active.x, maxX));
    const y = Math.max(8, Math.min(active.y, maxY));
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

  const session = useSession();

  if (!mounted || !active) return null;

  const hosts = active.hosts.length > 0 ? active.hosts : [active.host];
  const batch = hosts.length > 1;
  const isPinned = pinned.includes(active.host);

  let title = active.host;
  if (batch) title = `已选 ${hosts.length} 台`;

  return (
    <>
      <div
        className="fixed inset-0 z-[60]"
        onMouseDown={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
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
      >
        <div className="truncate px-3 py-1.5 text-xs text-muted">{title}</div>
        <MenuItem
          label="终端打开"
          onClick={() => {
            onClose();
            onOpenInTerminal(hosts);
          }}
        />
        <MenuItem
          label={isPinned ? "取消置顶" : "置顶"}
          disabled={batch}
          onClick={() => {
            onClose();
            onTogglePin(active.host);
          }}
        />
        <MenuItem
          label="编辑…"
          disabled={batch}
          onClick={() => {
            onClose();
            onEdit(active.host);
          }}
        />
        <MenuItem
          label="网络测速…"
          disabled={hosts.length > 2}
          onClick={() => {
            onClose();
            if (hosts.length === 2) session.openSpeedtest("pair", { a: hosts[0], b: hosts[1] });
            else session.openSpeedtest("pair", { a: "@local", b: active.host });
          }}
        />
        <div className="my-1 border-t border-line" />
        <MenuItem
          label="断开连接"
          danger
          onClick={() => {
            onClose();
            onDisconnect(hosts);
          }}
        />
      </div>
    </>
  );
}

function MenuItem({
  label,
  onClick,
  danger = false,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  let stateClass = "text-ink hover:bg-raised";
  if (disabled) {
    stateClass = "cursor-default text-muted";
  } else if (danger) {
    stateClass = "text-danger hover:bg-danger-soft";
  }

  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className={cn("flex h-8 w-full items-center px-3 text-left", stateClass)}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
