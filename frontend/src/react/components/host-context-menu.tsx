import { useEffect, useRef } from "react";
import { MOTION_MS, usePresence } from "@/react/lib/motion";
import { cn } from "@/react/lib/utils";

export type HostContextMenuState = {
  host: string;
  hosts: string[];
  x: number;
  y: number;
};

type Props = {
  menu: HostContextMenuState | null;
  pinned: string[];
  onClose: () => void;
  onOpen: (hosts: string[]) => void;
  onOpenInTerminal?: (hosts: string[]) => void;
  onTogglePin: (host: string) => void;
  onEdit: (host: string) => void;
  onDelete?: (hosts: string[]) => void;
  /** 侧边栏已打开的主机不提供删除。 */
  showDelete?: boolean;
  onDisconnect?: (host: string) => void;
};

export function HostContextMenu({
  menu,
  pinned,
  onClose,
  onOpen,
  onOpenInTerminal,
  onTogglePin,
  onEdit,
  onDelete,
  showDelete = true,
  onDisconnect,
}: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const lastMenuRef = useRef(menu);
  if (menu) lastMenuRef.current = menu;
  const { mounted, visible } = usePresence(!!menu, MOTION_MS.moderate);
  const active = menu ?? lastMenuRef.current;

  useEffect(() => {
    if (!active || !elRef.current) return;
    const rect = elRef.current.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 8;
    const maxY = window.innerHeight - rect.height - 8;
    const x = Math.max(8, Math.min(active.x, maxX));
    const y = Math.max(8, Math.min(active.y, maxY));
    elRef.current.style.left = `${x}px`;
    elRef.current.style.top = `${y}px`;
  }, [active]);

  if (!mounted || !active) return null;

  const hosts = active.hosts.length > 0 ? active.hosts : [active.host];
  const batch = hosts.length > 1;
  const isPinned = pinned.includes(active.host);

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
        className="motion-menu-panel fixed z-[61] min-w-[180px] rounded-surface border border-line bg-surface py-1 text-sm text-ink"
        data-open={visible ? "true" : "false"}
        style={{ left: active.x, top: active.y }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {batch ? (
          <div className="px-3 py-1.5 text-xs text-muted">已选 {hosts.length} 台</div>
        ) : null}
        <MenuItem
          label="打开"
          onClick={() => {
            onClose();
            onOpen(hosts);
          }}
        />
        {onOpenInTerminal ? (
          <MenuItem
            label="终端打开"
            onClick={() => {
              onClose();
              onOpenInTerminal(hosts);
            }}
          />
        ) : null}
        {!batch ? (
          <>
            <div className="my-1 border-t border-line" />
            <MenuItem
              label={isPinned ? "取消置顶" : "置顶"}
              onClick={() => {
                onClose();
                onTogglePin(active.host);
              }}
            />
            <MenuItem
              label="编辑…"
              onClick={() => {
                onClose();
                onEdit(active.host);
              }}
            />
            {onDisconnect ? (
              <MenuItem
                label="断开连接"
                danger
                onClick={() => {
                  onClose();
                  onDisconnect(active.host);
                }}
              />
            ) : null}
            {showDelete && onDelete ? (
              <>
                <div className="my-1 border-t border-line" />
                <MenuItem
                  label="删除…"
                  danger
                  onClick={() => {
                    onClose();
                    onDelete(hosts);
                  }}
                />
              </>
            ) : null}
          </>
        ) : showDelete && onDelete ? (
          <>
            <div className="my-1 border-t border-line" />
            <MenuItem
              label="删除…"
              danger
              onClick={() => {
                onClose();
                onDelete(hosts);
              }}
            />
          </>
        ) : null}
      </div>
    </>
  );
}

function MenuItem({
  label,
  onClick,
  danger = false,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full px-3 py-2 text-left hover:bg-raised",
        danger ? "text-danger" : "text-ink",
      )}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
