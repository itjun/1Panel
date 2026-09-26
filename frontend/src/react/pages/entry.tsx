import { Dialogs, Events } from "@wailsio/runtime";
import { useQuery } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { api, type main, type sshconfig } from "@/api";
import {
  InteractiveDataTable,
  type InteractiveColumn,
  type InteractiveSortOrder,
} from "@/react/components/data-table";
import { DistroBadge } from "@/react/components/distro-badge";
import { HostContextMenu, type HostContextMenuState } from "@/react/components/host-context-menu";
import { Button } from "@/react/components/ui/button";
import { Card } from "@/react/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/react/components/ui/dialog";
import { CodeSurface } from "@/react/components/code-surface";
import { Notice, Page } from "@/react/components/page";
import { ConfigConflictsPanel } from "@/react/pages/config-conflicts";
import { ConfigSshFilesPanel } from "@/react/pages/config-ssh";
import {
  FONT_OPTIONS,
  SETTINGS_DEFAULTS,
  resetSettings,
  updateSettings,
  useSettings,
} from "@/react/state/settings";
import { UNGROUPED_ID, useSession } from "@/react/state/session";
import { summarizeDisks } from "@/utils/alerts";
import { formatBytes, formatErr, formatMemCapacity } from "@/utils/format";
import { sortRowsByGroupValue, type GroupSortValue } from "@/utils/groupTableState";

const VIEW_MODE_KEY = "1pannel-group-view-mode";
const COL_WIDTHS_KEY = "1pannel-group-col-widths-v4";
const COL_ORDER_KEY = "1pannel-group-col-order-v1";
const TABLE_SORT_KEY = "1pannel-group-table-sort-v1";
const PINNED_SECTION = "pinned";

const GROUP_COL_KEYS = [
  "index",
  "host",
  "addr",
  "agent",
  "user",
  "version",
  "spec",
  "load",
  "cpu",
  "mem",
  "disk",
] as const;

type GroupColumnKey = (typeof GROUP_COL_KEYS)[number];

const GROUP_COL_LABELS: Record<GroupColumnKey, string> = {
  index: "序",
  host: "主机",
  addr: "地址",
  agent: "Agent",
  user: "用户",
  version: "版本",
  spec: "规格",
  load: "负载",
  cpu: "CPU",
  mem: "内存",
  disk: "磁盘",
};

const GROUP_DEFAULT_W: Record<GroupColumnKey, number> = {
  index: 64,
  host: 140,
  addr: 150,
  agent: 100,
  user: 64,
  version: 108,
  spec: 80,
  load: 100,
  cpu: 100,
  mem: 100,
  disk: 160,
};

const GROUP_MIN_W: Record<GroupColumnKey, number> = {
  index: 64,
  host: 132,
  addr: 150,
  agent: 112,
  user: 96,
  version: 108,
  spec: 96,
  load: 96,
  cpu: 100,
  mem: 100,
  disk: 160,
};

function readViewMode(): "table" | "board" {
  return localStorage.getItem(VIEW_MODE_KEY) === "board" ? "board" : "table";
}

function isGroupColumnKey(value: unknown): value is GroupColumnKey {
  return typeof value === "string" && (GROUP_COL_KEYS as readonly string[]).includes(value);
}

function readColumnOrder(): GroupColumnKey[] {
  try {
    const raw = localStorage.getItem(COL_ORDER_KEY);
    if (!raw) return [...GROUP_COL_KEYS];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...GROUP_COL_KEYS];
    const seen = new Set<GroupColumnKey>();
    const out: GroupColumnKey[] = [];
    for (const key of parsed) {
      if (isGroupColumnKey(key) && !seen.has(key)) {
        seen.add(key);
        out.push(key);
      }
    }
    for (const key of GROUP_COL_KEYS) {
      if (!seen.has(key)) out.push(key);
    }
    return out.length === GROUP_COL_KEYS.length ? out : [...GROUP_COL_KEYS];
  } catch {
    return [...GROUP_COL_KEYS];
  }
}

function readColWidths(): Record<string, number> {
  const out: Record<string, number> = { ...GROUP_DEFAULT_W };
  try {
    const raw = localStorage.getItem(COL_WIDTHS_KEY);
    if (!raw) return out;
    const obj = JSON.parse(raw) as Record<string, unknown>;
    for (const key of GROUP_COL_KEYS) {
      const value = Number(obj[key]);
      if (Number.isFinite(value) && value >= 32) out[key] = Math.round(value);
    }
  } catch {
    /* ignore */
  }
  return out;
}

function readTableSort(): { key: GroupColumnKey | null; order: InteractiveSortOrder } {
  try {
    const raw = localStorage.getItem(TABLE_SORT_KEY);
    if (!raw) return { key: null, order: null };
    const parsed = JSON.parse(raw) as { key?: unknown; order?: unknown };
    if (
      isGroupColumnKey(parsed.key) &&
      parsed.key !== "index" &&
      (parsed.order === "ascending" || parsed.order === "descending")
    ) {
      return { key: parsed.key, order: parsed.order };
    }
  } catch {
    /* ignore */
  }
  return { key: null, order: null };
}

function osVersion(osRelease: string): string {
  const text = (osRelease || "").trim();
  if (!text) return "";
  const matched = text.match(/\bv?\d+(?:\.\d+)+(?:\.\d+)?(?:\s+LTS)?\b/i);
  if (matched) return matched[0].replace(/^v/i, "");
  return text;
}

function isMacPlatform() {
  return /Mac|iPhone|iPad/.test(navigator.platform);
}

function isAdditiveSelect(event: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) {
  if (event.shiftKey) return false;
  if (isMacPlatform()) return event.metaKey && !event.ctrlKey;
  return event.ctrlKey && !event.metaKey;
}

/** 已由 settings-page.tsx 接管；保留实现避免误删，不再导出。 */
function SettingsPage() {
  const session = useSession();
  const settings = useSettings();
  const [ask, setAsk] = useState(true);
  const [message, setMessage] = useState("");
  const egress = useQuery({
    queryKey: ["egress"],
    queryFn: () => api.getMyEgress(),
  });
  const status = useQuery({
    queryKey: ["panel-config-status"],
    queryFn: () => api.getPanelConfigStatus(),
  });

  useQuery({
    queryKey: ["ask-before-quit"],
    queryFn: async () => {
      const value = await api.getAskBeforeQuit();
      setAsk(value);
      return value;
    },
  });

  const changed =
    settings.fontFamily !== SETTINGS_DEFAULTS.fontFamily ||
    settings.fontSize !== SETTINGS_DEFAULTS.fontSize ||
    settings.startupPage !== SETTINGS_DEFAULTS.startupPage ||
    !ask;

  return (
    <Page
      title="设置"
      actions={
        <Button
          disabled={!changed}
          onClick={() => {
            resetSettings();
            void api.setAskBeforeQuit(true).then(() => setAsk(true));
          }}
        >
          恢复默认值
        </Button>
      }
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        {message ? <Notice text={message} /> : null}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted">外观</h2>
          <SettingRow label="界面字体" hint="改完立刻生效">
            <select
              className="h-8 rounded-control border border-line bg-surface px-2"
              value={settings.fontFamily}
              onChange={(event) => updateSettings({ fontFamily: event.target.value })}
            >
              {FONT_OPTIONS.map((font) => (
                <option key={font.label} value={font.value}>
                  {font.label}
                </option>
              ))}
            </select>
          </SettingRow>
          <SettingRow label="界面字号" hint={`${settings.fontSize} px`}>
            <input
              type="range"
              min={11}
              max={20}
              value={settings.fontSize}
              onChange={(event) => updateSettings({ fontSize: Number(event.target.value) })}
            />
          </SettingRow>
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted">会话</h2>
          <SettingRow label="启动时打开">
            <label className="mr-3">
              <input
                type="radio"
                checked={settings.startupPage === "home"}
                onChange={() => updateSettings({ startupPage: "home" })}
              />
              应用首页
            </label>
            <label>
              <input
                type="radio"
                checked={settings.startupPage === "resume"}
                onChange={() => updateSettings({ startupPage: "resume" })}
              />
              离开画面
            </label>
          </SettingRow>
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted">应用</h2>
          <SettingRow label="本机出口" hint="公网 IP，来自 myip.ipip.net">
            <span>{egress.data?.ip || (egress.isLoading ? "检测中…" : "未知")}</span>
            {egress.data?.location ? (
              <span className="text-muted">{egress.data.location}</span>
            ) : null}
            <Button onClick={() => void egress.refetch()}>刷新</Button>
          </SettingRow>
          <SettingRow label="主机配置">
            <Button
              onClick={() => {
                void Dialogs.OpenFile({
                  Title: "选择备份位置",
                  CanChooseDirectories: true,
                  CanChooseFiles: false,
                  CanCreateDirectories: true,
                }).then((dir) => {
                  if (!dir) return;
                  return api.exportBackup(dir);
                }).then((msg) => {
                  if (msg) setMessage(msg);
                }).catch((error) => setMessage(formatErr(error)));
              }}
            >
              导出…
            </Button>
            <Button onClick={() => void Events.Emit("app-restart")}>重启应用</Button>
          </SettingRow>
          <SettingRow label="SSH 配置同步">
            <span>{statusLabel(status.data)}</span>
            <Button onClick={() => session.setConfigSection("overview")}>打开配置中心</Button>
          </SettingRow>
          <SettingRow label="退出前询问">
            <input
              type="checkbox"
              checked={ask}
              onChange={(event) => {
                const next = event.target.checked;
                setAsk(next);
                void api.setAskBeforeQuit(next);
              }}
            />
          </SettingRow>
        </section>
      </div>
    </Page>
  );
}

function statusLabel(status?: {
  needsReview?: boolean;
  configStale?: boolean;
  drift?: boolean;
}) {
  if (!status) return "检测中";
  if (status.needsReview) return "需导入确认";
  if (status.configStale) return "配置过期";
  if (status.drift) return "检测到外部修改";
  return "已同步";
}

function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-surface border border-line bg-surface px-5 py-4">
      <div>
        <div className="font-medium">{label}</div>
        {hint ? <div className="text-sm text-muted">{hint}</div> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function diffKindLabel(kind: string) {
  if (kind === "added") return "新增";
  if (kind === "removed") return "删除";
  if (kind === "changed") return "变更";
  return kind || "变化";
}

function formatUnixTime(value?: number) {
  if (!value) return "—";
  return new Date(value * (value < 1e12 ? 1000 : 1)).toLocaleString();
}

/** 已由 config-center.tsx 接管；保留实现避免误删，不再导出。 */
function ConfigCenterPage() {
  const session = useSession();
  const section = session.configSection;
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonDirty, setJsonDirty] = useState(false);
  const [selectedBackupId, setSelectedBackupId] = useState("");
  const [backupDetail, setBackupDetail] = useState<main.PanelBackup | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [preview, setPreview] = useState<main.PanelConfigPreview | null>(null);

  const overview = useQuery({
    queryKey: ["config-overview"],
    queryFn: () => api.getPanelConfigOverview(),
  });
  const draft = useQuery({
    queryKey: ["config-json"],
    queryFn: () => api.getEditablePanelState(),
    enabled: section === "json",
  });
  const files = useQuery({
    queryKey: ["config-files"],
    queryFn: () => api.getPanelConfigTree(),
    enabled: section === "files" || section === "diff" || section === "overview",
  });
  const backups = useQuery({
    queryKey: ["config-backups"],
    queryFn: () => api.listPanelBackups(),
    enabled: section === "backups",
  });

  useEffect(() => {
    if (!draft.data || jsonDirty) return;
    setJsonText(JSON.stringify(draft.data, null, 2));
  }, [draft.data, jsonDirty]);

  useEffect(() => {
    if (section !== "backups") return;
    const list = backups.data || [];
    if (!list.length) {
      setSelectedBackupId("");
      setBackupDetail(null);
      return;
    }
    const id =
      selectedBackupId && list.some((item) => item.id === selectedBackupId)
        ? selectedBackupId
        : list[0]!.id;
    if (id !== selectedBackupId) setSelectedBackupId(id);
    void api
      .getPanelBackup(id)
      .then(setBackupDetail)
      .catch((err) => setError(formatErr(err)));
  }, [backups.data, section, selectedBackupId]);

  const diff = overview.data?.diff;

  async function refreshAll() {
    setError("");
    await Promise.all([
      overview.refetch(),
      section === "json" ? draft.refetch() : Promise.resolve(),
      files.refetch(),
      section === "backups" ? backups.refetch() : Promise.resolve(),
    ]);
  }

  async function runPreviewImport() {
    setBusy(true);
    setError("");
    try {
      const tree = await api.getPanelConfigTree();
      const draftFiles = tree
        .filter((file) => !file.panelJson)
        .map((file) => ({
          path: file.path,
          content: file.content,
          mode: file.mode,
          sha256: file.sha256,
        }));
      const next = await api.previewConfigDraft({ files: draftFiles });
      setPreview(next);
      setMessage("已生成差异预览，确认无冲突后可提交。");
    } catch (err) {
      setError(formatErr(err));
    } finally {
      setBusy(false);
    }
  }

  async function runPreviewJson() {
    setBusy(true);
    setError("");
    try {
      const parsed = JSON.parse(jsonText) as main.PanelStateDraft;
      if (!parsed || !Array.isArray(parsed.hosts) || !Array.isArray(parsed.groups)) {
        throw new Error("必须包含 hosts 和 groups 数组");
      }
      const next = await api.previewPanelState(parsed);
      setPreview(next);
      setMessage("Panel JSON 预览已生成。");
    } catch (err) {
      setError(formatErr(err));
    } finally {
      setBusy(false);
    }
  }

  async function commitPreview() {
    if (!preview?.valid || !preview.previewId) return;
    setBusy(true);
    setError("");
    try {
      await api.commitPanelPreview(preview.previewId);
      setPreview(null);
      setJsonDirty(false);
      setMessage("已提交并备份当前配置。");
      await refreshAll();
      await session.refresh();
    } catch (err) {
      setError(formatErr(err));
    } finally {
      setBusy(false);
    }
  }

  async function restoreSelected() {
    if (!backupDetail) return;
    setBusy(true);
    setError("");
    try {
      await api.restorePanelBackup(backupDetail.summary.id);
      setRestoreOpen(false);
      setMessage("配置快照已恢复。");
      await refreshAll();
      await session.refresh();
    } catch (err) {
      setError(formatErr(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page
      title="配置中心"
      actions={
        <>
          <span className="text-sm text-muted">{statusLabel(overview.data)}</span>
          <Button disabled={busy} onClick={() => void refreshAll()}>
            刷新
          </Button>
          {overview.data?.drift || overview.data?.needsReview ? (
            <Button disabled={busy} onClick={() => void runPreviewImport()}>
              导入差异
            </Button>
          ) : null}
        </>
      }
    >
      {error ? <Notice text={error} /> : null}
      {message ? <Notice text={message} tone="warn" /> : null}

      {section === "overview" ? (
        <div className="flex flex-col gap-4">
          <Card>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => session.setConfigSection("json")}>
                编辑 Panel JSON
              </Button>
              <Button onClick={() => session.setConfigSection("files")}>查看 SSH 文件</Button>
              <Button onClick={() => session.setConfigSection("diff")}>差异与冲突</Button>
              <Button onClick={() => session.setConfigSection("backups")}>备份与恢复</Button>
            </div>
          </Card>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card>
              <div className="text-sm text-muted">Panel 主机</div>
              <div className="text-2xl">{overview.data?.hostCount ?? 0}</div>
              <div className="text-xs text-muted">Revision {overview.data?.revision ?? 0}</div>
            </Card>
            <Card>
              <div className="text-sm text-muted">分组</div>
              <div className="text-2xl">{overview.data?.groupCount ?? 0}</div>
            </Card>
            <Card>
              <div className="text-sm text-muted">SSH 文件</div>
              <div className="text-2xl">{overview.data?.configFileCount ?? 0}</div>
              <div className="text-xs text-muted">{overview.data?.includeCount ?? 0} 个 Include</div>
            </Card>
            <Card>
              <div className="text-sm text-muted">配置状态</div>
              <div className="text-lg">{statusLabel(overview.data)}</div>
              <div className="text-xs text-muted">
                上次生成 {formatUnixTime(overview.data?.lastGenerated)}
              </div>
            </Card>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <div className="mb-2 flex items-center justify-between">
                <div className="font-medium">配置位置</div>
                <Button
                  size="sm"
                  onClick={() => {
                    const path = overview.data?.panelPath || "";
                    if (path) void api.revealPanelPath(path);
                  }}
                >
                  定位
                </Button>
              </div>
              <div className="text-sm text-muted">Panel</div>
              <div className="truncate font-mono text-sm">{overview.data?.panelPath || "—"}</div>
              <div className="mt-2 text-sm text-muted">SSH</div>
              <div className="truncate font-mono text-sm">{overview.data?.sshConfigPath || "—"}</div>
            </Card>
            <Card>
              <div className="mb-2 flex items-center justify-between">
                <div className="font-medium">最近差异</div>
                <Button size="sm" onClick={() => session.setConfigSection("diff")}>
                  查看全部
                </Button>
              </div>
              <div className="text-sm text-muted">
                文件 {(diff?.changedFiles || []).length} · 主机 {(diff?.hostDiff || []).length}
              </div>
              {(diff?.changedFiles || []).slice(0, 3).map((file) => (
                <div key={file.path} className="mt-2 truncate text-sm">
                  {diffKindLabel(file.kind)} · {file.path}
                </div>
              ))}
              {!diff?.hasChanges ? <div className="mt-2 text-sm text-muted">当前无外部差异</div> : null}
            </Card>
          </div>
        </div>
      ) : null}

      {section === "json" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void runPreviewJson()}>
              预览变更
            </Button>
            <Button
              variant="primary"
              disabled={busy || !preview?.valid}
              onClick={() => void commitPreview()}
            >
              提交预览
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                void api.generatePanelConfig().then(() => {
                  setMessage("已生成 SSH 配置");
                  void refreshAll();
                }).catch((err) => setError(formatErr(err)));
              }}
            >
              生成 SSH 配置
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden border-t border-line">
            <CodeSurface
              value={jsonText}
              language="json"
              readOnly={false}
              onChange={(value) => {
                setJsonText(value);
                setJsonDirty(true);
              }}
            />
          </div>
          {preview ? <PreviewSummary preview={preview} /> : null}
        </div>
      ) : null}

      {section === "files" ? (
        <ConfigSshFilesPanel
          onOpenPanelJson={() => session.setConfigSection("json")}
          onCommitted={async () => {
            setPreview(null);
            setJsonDirty(false);
            await refreshAll();
            await session.refresh();
          }}
        />
      ) : null}

      {section === "diff" ? (
        <ConfigConflictsPanel
          onOpenSshFiles={() => session.setConfigSection("files")}
          onCommitted={async () => {
            setPreview(null);
            setJsonDirty(false);
            await refreshAll();
            await session.refresh();
          }}
        />
      ) : null}

      {section === "backups" ? (
        <div className="grid min-h-0 flex-1 md:grid-cols-[280px_1fr]">
          <div className="min-h-0 overflow-auto border-r border-line bg-surface">
            {(backups.data || []).map((backup) => (
              <button
                key={backup.id}
                type="button"
                className={`block w-full border-b border-line px-3 py-3 text-left hover:bg-raised ${
                  selectedBackupId === backup.id
                    ? "bg-accent-soft font-semibold text-accent"
                    : ""
                }`}
                onClick={() => setSelectedBackupId(backup.id)}
              >
                <div className="text-sm">{formatUnixTime(backup.createdAt)}</div>
                <div className="font-medium">Revision {backup.revision}</div>
                <div className="text-xs text-muted">
                  {backup.hostCount} 台 · {backup.fileCount} 文件 · {formatBytes(backup.size)}
                </div>
              </button>
            ))}
            {(backups.data || []).length === 0 ? (
              <p className="p-4 text-sm text-muted">暂无自动备份</p>
            ) : null}
          </div>
          <Card>
            {backupDetail ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xs text-muted">SNAPSHOT</div>
                    <h3 className="text-lg font-medium">
                      {formatUnixTime(backupDetail.summary.createdAt)}
                    </h3>
                    <div className="mt-1 text-sm text-muted">
                      Revision {backupDetail.summary.revision} · {formatBytes(backupDetail.summary.size)}
                    </div>
                    <div className="mt-1 truncate font-mono text-xs text-muted">
                      {backupDetail.summary.path}
                    </div>
                  </div>
                  <Button variant="primary" disabled={busy} onClick={() => setRestoreOpen(true)}>
                    恢复此快照
                  </Button>
                </div>
                <div className="mt-4 max-h-[48vh] overflow-auto border border-line">
                  {(backupDetail.files || []).map((file) => (
                    <div
                      key={file.path}
                      className="flex items-center justify-between border-b border-line px-3 py-2 text-sm"
                    >
                      <span className="truncate font-mono">{file.displayPath || file.path}</span>
                      <span className="text-muted">{formatBytes(file.size)}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-sm text-muted">
                  恢复会同时回滚 Panel JSON 与 SSH 文件树，恢复前会先创建当前状态快照；不要求远程主机在线。
                </p>
              </>
            ) : (
              <p className="text-muted">选择左侧备份查看详情</p>
            )}
          </Card>
        </div>
      ) : null}

      <Dialog open={restoreOpen} onOpenChange={setRestoreOpen}>
        <DialogContent>
          <DialogTitle>恢复配置快照</DialogTitle>
          <DialogDescription>
            将恢复 {formatUnixTime(backupDetail?.summary.createdAt)} 的 Panel JSON 与 SSH 文件树。当前状态会先自动备份。
          </DialogDescription>
          <DialogFooter>
            <Button onClick={() => setRestoreOpen(false)}>取消</Button>
            <Button variant="primary" disabled={busy} onClick={() => void restoreSelected()}>
              恢复
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}

function PreviewSummary({ preview }: { preview: main.PanelConfigPreview }) {
  return (
    <Card>
      <div className="font-medium">预览摘要</div>
      <div className="mt-1 text-sm text-muted">
        文件 {(preview.fileDiff || []).length} · 主机 {(preview.hostDiff || []).length} ·{" "}
        {preview.valid ? "可提交" : "存在冲突或无效"}
      </div>
      {(preview.fileDiff || []).slice(0, 5).map((file) => (
        <div key={file.path} className="mt-1 text-sm">
          {diffKindLabel(file.kind)} · {file.path}
        </div>
      ))}
    </Card>
  );
}

type GroupRow = {
  name: string;
  hostName: string;
  user: string;
  agent: string;
  version: string;
  spec: string;
  cpu: number | null;
  mem: number | null;
  disk: number | null;
  load: number | null;
  loadText: string;
  cpuText: string;
  memText: string;
  diskText: string;
};

/** 已由 group-page.tsx 接管；保留实现避免误删，不再导出。 */
function GroupPage() {
  const session = useSession();
  const [mode, setMode] = useState<"table" | "board">(readViewMode);
  const [columnOrder, setColumnOrder] = useState<GroupColumnKey[]>(readColumnOrder);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(readColWidths);
  const [sort, setSort] = useState(readTableSort);
  const hosts = session.hostsOf(session.activeGroupId || UNGROUPED_ID);
  const overview = useQuery({
    queryKey: ["group-overview", session.activeGroupId],
    queryFn: () => api.listOneGroupOverview(session.activeGroupId || UNGROUPED_ID),
    refetchInterval: 5000,
  });
  const byName = useMemo(() => {
    const map = new Map<string, main.HostOverviewSnapshot>();
    for (const host of overview.data?.hosts || []) map.set(host.name, host);
    return map;
  }, [overview.data]);

  const rows: GroupRow[] = useMemo(
    () =>
      hosts.map((host) => {
        const snap = byName.get(host.name);
        const ov = snap?.overview;
        const diskSum = summarizeDisks(snap?.disks);
        const agent = snap?.notInstalled
          ? "未安装"
          : snap?.error
            ? "异常"
            : snap
              ? "在线"
              : "—";
        return {
          name: host.name,
          hostName: host.hostName,
          user: host.user,
          agent,
          version: ov ? osVersion(ov.osRelease || "") || "—" : "—",
          spec: ov ? `${ov.cpuCount || 0}核${formatMemCapacity(ov.memTotal || 0)}` : "—",
          cpu: ov ? ov.cpuPercent : null,
          mem: ov ? ov.memPercent : null,
          disk: diskSum ? diskSum.percent : null,
          load: ov ? ov.load1 : null,
          loadText: ov ? `${(ov.load1 || 0).toFixed(2)} / ${ov.cpuCount || 0}` : "—",
          cpuText: ov ? `${ov.cpuPercent.toFixed(1)}%` : "—",
          memText: ov ? `${ov.memPercent.toFixed(1)}%` : "—",
          diskText: diskSum ? `${diskSum.percent.toFixed(1)}%` : "—",
        };
      }),
    [byName, hosts],
  );

  const sortedRows = useMemo(() => {
    if (!sort.key || !sort.order) return rows;
    return sortRowsByGroupValue(rows, (row) => groupRowSortValue(row, sort.key!), sort.order);
  }, [rows, sort]);

  const columns: InteractiveColumn<GroupRow>[] = useMemo(
    () =>
      GROUP_COL_KEYS.map((key) => ({
        key,
        label: GROUP_COL_LABELS[key],
        width: GROUP_DEFAULT_W[key],
        minWidth: GROUP_MIN_W[key],
        sortable: key !== "index",
        align: key === "index" || key === "load" ? "center" : "left",
        render: (row, index) => {
          if (key === "index") return index + 1;
          if (key === "host") return row.name;
          if (key === "addr") return row.hostName || "—";
          if (key === "agent") return row.agent;
          if (key === "user") return row.user || "—";
          if (key === "version") return row.version;
          if (key === "spec") return row.spec;
          if (key === "load") return row.loadText;
          if (key === "cpu") return row.cpuText;
          if (key === "mem") return row.memText;
          if (key === "disk") return row.diskText;
          return "—";
        },
      })),
    [],
  );

  function choose(next: "table" | "board") {
    setMode(next);
    localStorage.setItem(VIEW_MODE_KEY, next);
  }

  function persistOrder(next: string[]) {
    const filtered = next.filter(isGroupColumnKey);
    setColumnOrder(filtered);
    localStorage.setItem(COL_ORDER_KEY, JSON.stringify(filtered));
  }

  function persistWidths(next: Record<string, number>) {
    setColumnWidths(next);
    const custom: Record<string, number> = {};
    for (const key of GROUP_COL_KEYS) {
      if (next[key] != null && next[key] !== GROUP_DEFAULT_W[key]) custom[key] = next[key]!;
    }
    if (Object.keys(custom).length === 0) localStorage.removeItem(COL_WIDTHS_KEY);
    else localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(custom));
  }

  function persistSort(key: string | null, order: InteractiveSortOrder) {
    const next = {
      key: key && isGroupColumnKey(key) && key !== "index" ? key : null,
      order,
    };
    setSort(next);
    if (next.key && next.order) localStorage.setItem(TABLE_SORT_KEY, JSON.stringify(next));
    else localStorage.removeItem(TABLE_SORT_KEY);
  }

  function resetLayout() {
    setColumnOrder([...GROUP_COL_KEYS]);
    setColumnWidths({ ...GROUP_DEFAULT_W });
    localStorage.removeItem(COL_ORDER_KEY);
    localStorage.removeItem(COL_WIDTHS_KEY);
  }

  const hasCustomLayout =
    columnOrder.some((key, index) => key !== GROUP_COL_KEYS[index]) ||
    GROUP_COL_KEYS.some((key) => columnWidths[key] !== GROUP_DEFAULT_W[key]);

  return (
    <Page
      title={session.groupName(session.activeGroupId)}
      actions={
        <>
          <Button variant={mode === "table" ? "primary" : "secondary"} onClick={() => choose("table")}>
            表格
          </Button>
          <Button variant={mode === "board" ? "primary" : "secondary"} onClick={() => choose("board")}>
            看板
          </Button>
          <Button onClick={() => void api.openBoardWindow(session.activeGroupId || UNGROUPED_ID)}>
            弹出看板
          </Button>
          {mode === "table" && hasCustomLayout ? (
            <Button onClick={resetLayout}>恢复默认列布局</Button>
          ) : null}
          <Button onClick={() => void overview.refetch()}>刷新</Button>
        </>
      }
    >
      {mode === "table" ? (
        <InteractiveDataTable
          columns={columns}
          data={sortedRows}
          columnOrder={columnOrder}
          columnWidths={columnWidths}
          sortKey={sort.key}
          sortOrder={sort.order}
          onColumnOrderChange={persistOrder}
          onColumnWidthsChange={persistWidths}
          onSortChange={persistSort}
          onRowDoubleClick={(row) => session.openHost(row.name, "overview")}
          getRowId={(row) => row.name}
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4 rounded-surface bg-graphite p-4 text-graphite-text">
          {rows.map((row) => (
            <button
              key={row.name}
              type="button"
              className="rounded-surface border border-line bg-graphite p-5 text-left"
              onDoubleClick={() => session.openHost(row.name, "overview")}
            >
              <div className="font-medium">{row.name}</div>
              <div className="mt-2 text-sm text-muted">{row.hostName}</div>
              <div className="mt-3 text-sm">
                CPU {row.cpuText} · 内存 {row.memText}
              </div>
              <div className="mt-1 text-sm text-muted">Agent {row.agent}</div>
            </button>
          ))}
        </div>
      )}
    </Page>
  );
}

function groupRowSortValue(row: GroupRow, key: GroupColumnKey): GroupSortValue {
  if (key === "host") return row.name;
  if (key === "addr") return row.hostName;
  if (key === "agent") return row.agent;
  if (key === "user") return row.user;
  if (key === "version") return row.version === "—" ? null : row.version;
  if (key === "spec") return row.spec === "—" ? null : row.spec;
  if (key === "cpu") return row.cpu;
  if (key === "mem") return row.mem;
  if (key === "disk") return row.disk;
  if (key === "load") return row.load;
  return null;
}

/** 已由 host-home.tsx 接管；保留实现避免误删，不再导出。 */
function HostHomePage() {
  const session = useSession();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState<"host" | "group" | "">("");
  const [selected, setSelected] = useState<string[]>([]);
  const [selectionSection, setSelectionSection] = useState<string | null>(null);
  const [menu, setMenu] = useState<HostContextMenuState | null>(null);
  const [deleting, setDeleting] = useState<string[] | null>(null);
  const [insertMark, setInsertMark] = useState<{
    sectionId: string;
    target: string;
    after: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const keyword = query.trim().toLowerCase();

  const sections = useMemo(() => {
    const pinnedNames = session.pinned;
    const pinnedHosts = pinnedNames
      .map((name) => session.hosts.find((host) => host.name === name))
      .filter((host): host is sshconfig.HostConfig => !!host);
    const groups = [...session.groups].sort((a, b) => a.order - b.order);
    const list = [
      { id: PINNED_SECTION, name: "置顶", hosts: pinnedHosts },
      ...groups.map((group) => ({
        id: group.id,
        name: group.name,
        hosts: session.hostsOf(group.id),
      })),
      { id: UNGROUPED_ID, name: "未分组", hosts: session.hostsOf(UNGROUPED_ID) },
    ];
    if (!keyword) {
      return list.filter((section) =>
        section.id === PINNED_SECTION ? section.hosts.length > 0 : true,
      );
    }
    return list
      .map((section) => ({
        ...section,
        hosts: section.hosts.filter((host) =>
          `${host.name} ${host.hostName} ${host.user}`.toLowerCase().includes(keyword),
        ),
      }))
      .filter((section) => section.hosts.length > 0);
  }, [keyword, session]);

  const selectHost = useCallback(
    (sectionId: string, name: string, event: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) => {
      if (isAdditiveSelect(event)) {
        setSelectionSection(sectionId);
        setSelected((prev) =>
          prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name],
        );
        return;
      }
      if (event.shiftKey && selectionSection === sectionId && selected.length > 0) {
        const section = sections.find((item) => item.id === sectionId);
        if (!section) return;
        const names = section.hosts.map((host) => host.name);
        const anchor = selected[selected.length - 1]!;
        const from = names.indexOf(anchor);
        const to = names.indexOf(name);
        if (from >= 0 && to >= 0) {
          const [a, b] = from < to ? [from, to] : [to, from];
          setSelected(names.slice(a, b + 1));
          return;
        }
      }
      setSelectionSection(sectionId);
      setSelected([name]);
    },
    [sections, selected, selectionSection],
  );

  async function reorderNear(
    sectionId: string,
    dragged: string,
    target: string,
    after: boolean,
  ) {
    if (dragged === target) return;
    if (sectionId === PINNED_SECTION) {
      const names = session.pinned.filter(Boolean);
      if (!names.includes(dragged) || !names.includes(target)) return;
      const next = names.filter((name) => name !== dragged);
      let index = next.indexOf(target);
      if (index < 0) return;
      if (after) index += 1;
      next.splice(index, 0, dragged);
      session.reorderPinned(next);
      return;
    }
    if (sectionId === UNGROUPED_ID) return;
    const group = session.groups.find((item) => item.id === sectionId);
    if (!group) return;
    const names = (group.hosts || []).filter(Boolean);
    if (!names.includes(dragged) || !names.includes(target)) return;
    const next = names.filter((name) => name !== dragged);
    let index = next.indexOf(target);
    if (index < 0) return;
    if (after) index += 1;
    next.splice(index, 0, dragged);
    const same =
      next.length === names.length && next.every((name, i) => name === names[i]);
    if (same) return;
    await api.reorderGroupHosts(sectionId, next);
    await session.refresh();
  }

  function onHostPointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
    sectionId: string,
    hostName: string,
  ) {
    if (event.button !== 0) return;
    if (isAdditiveSelect(event) || event.shiftKey) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let active = false;
    const pointerId = event.pointerId;
    const targetEl = event.currentTarget as HTMLElement;
    targetEl.setPointerCapture(pointerId);

    function onMove(moveEvent: PointerEvent) {
      if (moveEvent.pointerId !== pointerId) return;
      if (!active) {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 6) return;
        active = true;
        suppressClick.current = true;
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
      }
      const node = document
        .elementFromPoint(moveEvent.clientX, moveEvent.clientY)
        ?.closest("[data-host-sort]") as HTMLElement | null;
      if (!node) {
        insertMarkRef.current = null;
        setInsertMark(null);
        return;
      }
      const groupId = node.dataset.hostGroup || "";
      const target = node.dataset.hostSort || "";
      if (!groupId || !target || groupId !== sectionId || target === hostName) {
        insertMarkRef.current = null;
        setInsertMark(null);
        return;
      }
      const rect = node.getBoundingClientRect();
      const after = moveEvent.clientY > rect.top + rect.height / 2;
      const next = { sectionId: groupId, target, after };
      insertMarkRef.current = next;
      setInsertMark(next);
    }

    async function onUp(upEvent: PointerEvent) {
      if (upEvent.pointerId !== pointerId) return;
      targetEl.releasePointerCapture(pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      const mark = insertMarkRef.current;
      insertMarkRef.current = null;
      setInsertMark(null);
      if (!active) return;
      if (mark && mark.sectionId === sectionId) {
        try {
          await reorderNear(sectionId, hostName, mark.target, mark.after);
        } catch (err) {
          console.error(err);
        }
      }
      setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // insertMark 在 pointerup 闭包里需要最新值
  const insertMarkRef = useRef(insertMark);
  insertMarkRef.current = insertMark;

  async function confirmDelete() {
    if (!deleting?.length) return;
    for (const name of deleting) {
      await api.deleteHost(name);
    }
    setDeleting(null);
    setSelected([]);
    await session.refresh();
  }

  return (
    <div className="flex h-full min-h-0 bg-canvas">
      <div className="min-w-0 flex-1 overflow-auto">
        <div className="mb-4 flex gap-2 px-4 pt-4 md:px-6">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="筛选主机"
            className="h-8 w-full max-w-sm rounded-control border border-line bg-surface px-3"
          />
          <Button onClick={() => setCreating("group")}>新建分组</Button>
          <Button variant="primary" onClick={() => setCreating("host")}>
            新建主机
          </Button>
        </div>
        {creating ? (
          <CreateForm
            kind={creating}
            onClose={() => setCreating("")}
            onDone={() => {
              setCreating("");
              void session.refresh();
            }}
          />
        ) : null}
        <div className="flex flex-col bg-surface">
          {sections.map((section) => (
            <section key={section.id} className="bg-surface" data-drop-group={section.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-[18px] py-3 text-left"
                onClick={() => {
                  if (section.id !== PINNED_SECTION) session.openGroup(section.id);
                }}
              >
                <span className="font-medium">{section.name}</span>
                <span className="text-sm text-muted">{section.hosts.length}</span>
              </button>
              <div className="flex flex-col">
                {section.hosts.map((host) => {
                  const selectedRow = selected.includes(host.name);
                  const mark =
                    insertMark?.sectionId === section.id && insertMark.target === host.name
                      ? insertMark.after
                        ? "after"
                        : "before"
                      : null;
                  return (
                    <div
                      key={`${section.id}-${host.name}`}
                      data-host-sort={host.name}
                      data-host-group={section.id}
                      className={`group relative flex h-[60px] cursor-grab items-center gap-[14px] px-[18px] active:cursor-grabbing ${
                        selectedRow
                          ? "bg-accent-soft font-semibold text-accent"
                          : "bg-surface hover:bg-raised"
                      }`}
                      onPointerDown={(event) => onHostPointerDown(event, section.id, host.name)}
                      onClick={(event) => {
                        if (suppressClick.current) return;
                        selectHost(section.id, host.name, event);
                      }}
                      onDoubleClick={() => {
                        if (suppressClick.current) return;
                        session.openHost(host.name, "overview");
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        const hosts = selected.includes(host.name) ? selected.slice() : [host.name];
                        if (!selected.includes(host.name)) {
                          setSelected([host.name]);
                          setSelectionSection(section.id);
                        }
                        setMenu({
                          host: host.name,
                          hosts,
                          x: event.clientX,
                          y: event.clientY,
                        });
                      }}
                    >
                      {mark === "before" ? (
                        <div className="absolute inset-x-[18px] top-0 h-0.5 bg-accent" />
                      ) : null}
                      {mark === "after" ? (
                        <div className="absolute inset-x-[18px] bottom-0 h-0.5 bg-accent" />
                      ) : null}
                      <DistroBadge osRelease={session.osRelease[host.name]} />
                      <div className="min-w-0 flex-1">
                        <div
                          className={`truncate font-semibold ${
                            selectedRow ? "text-accent" : "text-ink"
                          }`}
                        >
                          {host.name}
                        </div>
                        <div className="truncate text-[12px] leading-tight text-muted">
                          ssh, {host.user || "root"}
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label="编辑主机"
                        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-muted hover:bg-raised ${
                          selectedRow
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                        }`}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          session.setEditingHost(host.name);
                        }}
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>

      <HostContextMenu
        menu={menu}
        pinned={session.pinned}
        onClose={() => setMenu(null)}
        onOpen={(hosts) => {
          for (const name of hosts) session.openHost(name, "overview");
        }}
        onTogglePin={(host) => session.togglePin(host)}
        onEdit={(name) => session.setEditingHost(name)}
        onDelete={(hosts) => setDeleting(hosts)}
      />

      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogTitle>删除主机</DialogTitle>
          <DialogDescription>
            确定删除 {(deleting || []).join("、")}？此操作不可撤销。
          </DialogDescription>
          <DialogFooter>
            <Button onClick={() => setDeleting(null)}>取消</Button>
            <Button variant="danger" onClick={() => void confirmDelete()}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const EDIT_INPUT =
  "h-9 w-full rounded-[4px] border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-accent disabled:bg-raised disabled:text-muted";

/** 已由 host-form.tsx 接管；保留实现避免误删，不再导出。 */
function HostEditForm({
  host,
  onClose,
  onDone,
}: {
  host: sshconfig.HostConfig;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const session = useSession();
  const [hostName, setHostName] = useState(host.hostName);
  const [user, setUser] = useState(host.user);
  const [password, setPassword] = useState("");
  const [note, setNote] = useState(host.note || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const groupId = session.groupIdOf(host.name);
  const groupLabel = groupId ? session.groupName(groupId) : "未分组";
  const portDisplay = (host.port || "").trim() || "22";

  useEffect(() => {
    setHostName(host.hostName);
    setUser(host.user);
    setNote(host.note || "");
    setPassword("");
    setError("");
    void api
      .getHostPassword(host.name)
      .then((pwd) => setPassword(pwd || ""))
      .catch(() => {
        /* 失败留空 */
      });
  }, [host]);

  function handleSave() {
    if (!hostName.trim() || !user.trim() || !password) {
      setError("地址、用户、密码不能为空");
      return;
    }
    setBusy(true);
    setError("");
    void api
      .updateHost({
        name: host.name,
        hostName: hostName.trim(),
        user: user.trim(),
        password,
        note,
      })
      .then(onDone)
      .catch((err) => setError(formatErr(err)))
      .finally(() => setBusy(false));
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto px-5 pb-4 pt-5">
        <div className="mb-6 flex items-start gap-3">
          <DistroBadge osRelease={session.osRelease[host.name]} />
          <div className="min-w-0 flex-1">
            <div className="text-lg font-semibold leading-tight text-ink">编辑主机</div>
            <div className="mt-0.5 truncate text-[12px] text-muted">{host.name}</div>
          </div>
          <button
            type="button"
            aria-label="关闭"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] text-muted hover:bg-raised"
            onClick={onClose}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6L6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error ? (
          <div className="mb-4">
            <Notice text={error} />
          </div>
        ) : null}

        <section className="mb-5">
          <div className="mb-2 text-[12px] text-muted">地址</div>
          <input
            className={EDIT_INPUT}
            placeholder="IP / 域名"
            value={hostName}
            onChange={(event) => setHostName(event.target.value)}
          />
        </section>

        <section className="mb-5">
          <div className="mb-2 text-[12px] text-muted">常规</div>
          <div className="flex flex-col gap-2">
            <input
              className={EDIT_INPUT}
              value={host.name}
              disabled
              title="别名不可在此修改"
            />
            <input
              className={EDIT_INPUT}
              value={groupLabel}
              disabled
              title="所在分组"
            />
          </div>
        </section>

        <section className="mb-5">
          <div className="mb-2 text-[12px] text-muted">SSH</div>
          <div className="flex items-center gap-2 text-sm text-ink">
            <span>端口</span>
            <input
              className="h-9 w-16 rounded-[4px] border border-line bg-raised px-2 text-center text-sm text-muted"
              value={portDisplay}
              disabled
              readOnly
            />
          </div>
        </section>

        <section className="mb-5">
          <div className="mb-2 text-[12px] text-muted">登录</div>
          <div className="flex flex-col gap-2">
            <input
              className={EDIT_INPUT}
              placeholder="用户"
              value={user}
              onChange={(event) => setUser(event.target.value)}
            />
            <input
              className={EDIT_INPUT}
              placeholder="密码"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
        </section>

        <section className="mb-2">
          <div className="mb-2 text-[12px] text-muted">备注</div>
          <textarea
            className="min-h-[88px] w-full resize-y rounded-[4px] border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            placeholder="备注"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </section>
      </div>

      <div className="shrink-0 border-t border-line p-4">
        <button
          type="button"
          disabled={busy || !hostName.trim() || !user.trim() || !password}
          className="h-10 w-full rounded-[4px] bg-accent text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
          onClick={handleSave}
        >
          {busy ? "验证并保存…" : "测试并保存"}
        </button>
      </div>
    </div>
  );
}

function CreateForm({
  kind,
  onClose,
  onDone,
}: {
  kind: "host" | "group";
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [hostName, setHostName] = useState("");
  const [user, setUser] = useState("root");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  return (
    <Card className="mb-4">
      {error ? <Notice text={error} /> : null}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <input
          className="h-8 rounded-control border border-line px-3"
          placeholder={kind === "group" ? "分组名" : "别名"}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        {kind === "host" ? (
          <>
            <input
              className="h-8 rounded-control border border-line px-3"
              placeholder="地址"
              value={hostName}
              onChange={(event) => setHostName(event.target.value)}
            />
            <input
              className="h-8 rounded-control border border-line px-3"
              placeholder="用户"
              value={user}
              onChange={(event) => setUser(event.target.value)}
            />
            <input
              className="h-8 rounded-control border border-line px-3"
              placeholder="密码"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </>
        ) : null}
      </div>
      <div className="mt-3 flex gap-2">
        <Button
          variant="primary"
          onClick={() => {
            const run =
              kind === "group"
                ? api.upsertGroup({ id: "", name, parentId: "", order: 0, hosts: [] })
                : api.addHost({ name, hostName, user, password, note: "" });
            void run.then(onDone).catch((err) => setError(formatErr(err)));
          }}
        >
          保存
        </Button>
        <Button onClick={onClose}>取消</Button>
      </div>
    </Card>
  );
}
