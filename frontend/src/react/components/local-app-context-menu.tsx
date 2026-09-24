import { useEffect, useRef } from "react";
import type { localapps } from "@/api";
import { copyText } from "@/utils/clipboard";
import { formatBytes, formatDurationLong, formatErr } from "@/utils/format";
import { localLangLabel } from "@/utils/localLang";

export type LocalAppMenuTarget = {
  x: number;
  y: number;
  appName: string;
  runtime: string;
  proc: localapps.ProcNode;
};

export function LocalAppContextMenu({
  menu,
  onClose,
  onDetail,
  onKill,
}: {
  menu: LocalAppMenuTarget | null;
  onClose: () => void;
  onDetail: (proc: localapps.ProcNode) => void;
  onKill: (proc: localapps.ProcNode) => void;
}) {
  const elRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, onClose]);

  useEffect(() => {
    if (!menu || !elRef.current) return;
    const rect = elRef.current.getBoundingClientRect();
    const pad = 8;
    let left = menu.x;
    let top = menu.y;
    if (left + rect.width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = Math.max(pad, window.innerHeight - rect.height - pad);
    }
    elRef.current.style.left = `${left}px`;
    elRef.current.style.top = `${top}px`;
  }, [menu]);

  if (!menu) return null;

  const active = menu;
  const proc = active.proc;
  const startCmd = (proc.cmd || "").trim();
  const cwd = (proc.cwd || "").trim();
  const cdAndCmd =
    cwd && startCmd ? `cd ${shellQuote(cwd)} && ${startCmd}` : "";
  const isSelf = proc.extra?.self === "1";
  const canKill = !!proc.pid && !isSelf;

  async function copyAll() {
    const appName = active.appName;
    const runtime = active.runtime;
    onClose();
    const lines = [
      `### 进程 ${appName || proc.pid}`,
      `- PID / PPID: ${proc.pid ?? "—"} / ${proc.ppid ?? "—"}`,
      `- 用户: ${proc.user || "—"}`,
      `- 运行时: ${localLangLabel(runtime || "")}`,
      `- CPU: ${Number(proc.cpu || 0).toFixed(2)}%`,
      `- 内存 RSS: ${formatBytes(proc.rss || 0)}`,
      `- 线程数: ${proc.threadCount ?? "—"}`,
      `- 已运行: ${proc.elapsed != null ? formatDurationLong(proc.elapsed) : "—"}`,
      `- 可执行: ${proc.exe || "—"}`,
      `- 工作目录: ${proc.cwd || "—"}`,
      `- 端口: ${(proc.ports || []).join("、") || "—"}`,
      `- 命令: ${proc.cmd || "—"}`,
    ];
    if (proc.extra) {
      for (const [key, value] of Object.entries(proc.extra)) {
        if (value != null && String(value).length > 0) {
          lines.push(`- ${key}: ${value}`);
        }
      }
    }
    try {
      await copyText(lines.join("\n"));
    } catch (error) {
      console.error(`复制失败: ${formatErr(error)}`);
    }
  }

  async function copyStart() {
    onClose();
    if (!startCmd) return;
    try {
      await copyText(startCmd);
    } catch (error) {
      console.error(`复制失败: ${formatErr(error)}`);
    }
  }

  async function copyCd() {
    onClose();
    if (!cdAndCmd) return;
    try {
      await copyText(cdAndCmd);
    } catch (error) {
      console.error(`复制失败: ${formatErr(error)}`);
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onMouseDown={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        ref={elRef}
        className="fixed z-50 min-w-[180px] rounded-surface border border-line bg-surface py-1 shadow-lg"
        style={{ left: active.x, top: active.y }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <MenuItem
          label="查看详情"
          onClick={() => {
            onDetail(proc);
            onClose();
          }}
        />
        <div className="my-1 border-t border-line" />
        <MenuItem label="复制全部信息" onClick={() => void copyAll()} />
        <MenuItem
          label="复制启动命令"
          disabled={!startCmd}
          onClick={() => void copyStart()}
        />
        <MenuItem
          label="复制 cd && cmd"
          disabled={!cdAndCmd}
          onClick={() => void copyCd()}
        />
        {canKill ? (
          <>
            <div className="my-1 border-t border-line" />
            <MenuItem
              label="结束进程"
              danger
              onClick={() => {
                onKill(proc);
                onClose();
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
  disabled,
  danger,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={
        danger
          ? "block h-9 w-full px-3 text-left text-sm text-danger hover:bg-danger/10 disabled:opacity-40"
          : "block h-9 w-full px-3 text-left text-sm text-ink hover:bg-raised disabled:opacity-40"
      }
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function shellQuote(path: string) {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(path)) return path;
  return `'${path.replace(/'/g, `'\\''`)}'`;
}
