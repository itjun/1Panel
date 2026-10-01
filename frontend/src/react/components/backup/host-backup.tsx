import { Dialogs } from "@wailsio/runtime";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { api, type main } from "@/api";
import { Button } from "@/react/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/react/components/ui/dialog";
import { RadioGroup } from "@/react/components/ui/radio-group";
import { Tag } from "@/react/components/ui/tag";
import { useSession } from "@/react/state/session";
import { formatErr } from "@/utils/format";

const BACKUP_FILTERS = [{ DisplayName: "1Panel 备份 (*.zip, *.json)", Pattern: "*.zip;*.json" }];

function fileStamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/** 选保存位置并导出迁移包；用户取消时返回 null */
export async function exportHostBackup(): Promise<string | null> {
  const path = await Dialogs.SaveFile({
    Title: "导出主机配置",
    Filename: `1panel-backup-${fileStamp()}.zip`,
    CanCreateDirectories: true,
    Filters: [{ DisplayName: "1Panel 备份 (*.zip)", Pattern: "*.zip" }],
  });
  if (!path) return null;
  return api.exportBackup(path);
}

/** 选择要恢复的备份文件；用户取消时返回 null */
export async function pickHostBackupFile(): Promise<string | null> {
  const path = await Dialogs.OpenFile({
    Title: "选择备份文件",
    CanChooseFiles: true,
    CanChooseDirectories: false,
    Filters: BACKUP_FILTERS,
  });
  return path || null;
}

function osLabel(os?: string): string {
  if (os === "darwin") return "macOS";
  if (os === "windows") return "Windows";
  if (os === "linux") return "Linux";
  return "旧版备份";
}

function formatTime(value?: number): string {
  if (!value) return "—";
  return new Date(value * 1000).toLocaleString();
}

function restoreSummary(res: main.ImportResult): string {
  const overwritten = res.overwritten?.length ?? 0;
  const skipped = res.skipped?.length ?? 0;
  const parts = [`新增 ${res.added?.length ?? 0} 台`];
  if (overwritten) parts.push(`覆盖 ${overwritten} 台`);
  if (skipped) parts.push(`跳过 ${skipped} 台`);
  if (res.keys) parts.push(`写入 ${res.keys} 个密钥`);
  if (res.knownHosts) parts.push(`known_hosts 新增 ${res.knownHosts} 条`);
  return `已恢复主机配置：${parts.join("，")}`;
}

/**
 * 恢复预览与确认（§7「数据导入 · 批量确认」）：先读迁移包给出摘要，
 * 用户选择同名主机的处理方式后再提交。
 */
export function HostBackupRestoreDialog({
  path,
  onClose,
  onRestored,
  onError,
}: {
  path: string | null;
  onClose: () => void;
  onRestored: (message: string) => void;
  onError: (message: string) => void;
}) {
  const session = useSession();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"skip" | "overwrite">("skip");
  const [busy, setBusy] = useState(false);
  const preview = useQuery({
    queryKey: ["host-backup-preview", path],
    queryFn: () => api.previewBackup(path as string),
    enabled: !!path,
    retry: false,
    gcTime: 0,
  });

  useEffect(() => {
    if (path) setMode("skip");
  }, [path]);

  async function restore() {
    if (!path) return;
    setBusy(true);
    try {
      const res = await api.restoreBackup(path, mode === "overwrite");
      onRestored(restoreSummary(res));
      onClose();
      await queryClient.invalidateQueries();
      await session.refresh();
    } catch (err) {
      onError(formatErr(err));
    } finally {
      setBusy(false);
    }
  }

  const data = preview.data;
  const newHosts = data?.newHosts ?? [];
  const conflicts = data?.conflicts ?? [];
  const keyWrites = data?.keyWrites ?? [];
  const keyRenames = data?.keyRenames ?? [];
  const droppedOptions = data?.droppedOptions ?? [];
  return (
    <Dialog open={!!path} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogTitle>恢复主机配置</DialogTitle>
        <DialogDescription>
          恢复前会自动快照当前配置；恢复后无需逐台测试连接。
        </DialogDescription>
        <p className="mt-2 truncate font-mono text-xs text-muted" data-tip={path ?? ""} data-tip-overflow="">
          {path}
        </p>

        {preview.isLoading ? <p className="mt-4 text-sm text-muted">读取备份中…</p> : null}
        {preview.error ? (
          <p className="mt-4 text-sm text-danger">{formatErr(preview.error)}</p>
        ) : null}

        {data ? (
          <div className="mt-4 flex flex-col gap-4 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
              <SummaryRow label="来源">
                {osLabel(data.sourceOS)} · {formatTime(data.createdAt)}
              </SummaryRow>
              <SummaryRow label="主机">
                <span className="tabular-nums">{data.hosts}</span> 台（新增{" "}
                <span className="tabular-nums">{newHosts.length}</span>，同名{" "}
                <span className="tabular-nums">{conflicts.length}</span>）
                {data.includesPasswords ? (
                  <Tag tone="warn" className="ml-2">
                    含明文密码
                  </Tag>
                ) : null}
              </SummaryRow>
              <SummaryRow label="分组">
                <span className="tabular-nums">{data.groups}</span> 个
              </SummaryRow>
              <SummaryRow label="密钥">
                <span className="tabular-nums">{data.keys}</span> 个文件
                {keyWrites.length ? `，将写入 ${keyWrites.length} 个` : "，本机已存在"}
              </SummaryRow>
              <SummaryRow label="known_hosts">{data.knownHosts ? "合并缺失条目" : "无"}</SummaryRow>
            </dl>

            {conflicts.length ? (
              <section className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-ink">同名主机</span>
                  <RadioGroup
                    aria-label="同名主机处理方式"
                    value={mode}
                    onChange={setMode}
                    disabled={busy}
                    options={[
                      { value: "skip", label: "保留本机" },
                      { value: "overwrite", label: "以备份覆盖" },
                    ]}
                  />
                </div>
                <PathList items={conflicts} />
              </section>
            ) : null}

            {keyRenames.length ? (
              <section className="flex flex-col gap-2">
                <span className="font-semibold text-ink">同名密钥内容不同，另存为</span>
                <PathList items={keyRenames} />
              </section>
            ) : null}

            {droppedOptions.length ? (
              <section className="flex flex-col gap-2">
                <span className="font-semibold text-ink">本机系统不支持，将忽略</span>
                <PathList items={droppedOptions} />
              </section>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" disabled={busy || !data} onClick={() => void restore()}>
            {busy ? "恢复中…" : "恢复"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </>
  );
}

function PathList({ items }: { items: string[] }) {
  return (
    <ul className="max-h-24 overflow-auto rounded-control bg-raised px-3 py-2 font-mono text-xs text-muted">
      {items.map((item) => (
        <li key={item} className="truncate" data-tip={item} data-tip-overflow="">
          {item}
        </li>
      ))}
    </ul>
  );
}
