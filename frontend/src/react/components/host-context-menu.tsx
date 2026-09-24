import { useEffect, useRef } from "react";
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
  onTogglePin,
  onEdit,
  onDelete,
  showDelete = true,
  onDisconnect,
}: Props) {
  const elRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu || !elRef.current) return;
    const rect = elRef.current.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 8;
    const maxY = window.innerHeight - rect.height - 8;
    const x = Math.max(8, Math.min(menu.x, maxX));
    const y = Math.max(8, Math.min(menu.y, maxY));
    elRef.current.style.left = `${x}px`;
    elRef.current.style.top = `${y}px`;
  }, [menu]);

  if (!menu) return null;

  const hosts = menu.hosts.length > 0 ? menu.hosts : [menu.host];
  const batch = hosts.length > 1;
  const isPinned = pinned.includes(menu.host);

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
        className="fixed z-[61] min-w-[180px] rounded-surface border border-line bg-surface py-1 text-sm text-ink"
        style={{ left: menu.x, top: menu.y }}
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
        {!batch ? (
          <>
            <div className="my-1 border-t border-line" />
            <MenuItem
              label={isPinned ? "取消置顶" : "置顶"}
              onClick={() => {
                onClose();
                onTogglePin(menu.host);
              }}
            />
            <MenuItem
              label="编辑…"
              onClick={() => {
                onClose();
                onEdit(menu.host);
              }}
            />
            {onDisconnect ? (
              <MenuItem
                label="断开连接"
                danger
                onClick={() => {
                  onClose();
                  onDisconnect(menu.host);
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
