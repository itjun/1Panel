import { Dialogs, Events } from "@wailsio/runtime";
import { useQuery } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from "react";
import { api, type LocalTextCheck, type monitor } from "@/api";
import { EncodeCheckDialog } from "@/react/components/encode-check-dialog";
import { FilePreviewDrawer } from "@/react/components/file-preview-drawer";
import { HighlightPane } from "@/react/components/local/highlight-pane";
import { Button } from "@/react/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/react/components/ui/dialog";
import { Notice, Page } from "@/react/components/page";
import { SftpPage } from "@/react/pages/sftp-page";
import { useSession, type Tool } from "@/react/state/session";
import { registerFileDrop } from "@/utils/fileDrop";
import { aptHighlightHtml } from "@/utils/aptHighlight";
import { highlightFileHtml } from "@/utils/codeHighlight";
import { hostsHighlightHtml } from "@/utils/hostsHighlight";
import { nginxHighlightHtml } from "@/utils/nginxHighlight";
import {
  formatBytes,
  formatErr,
  modeToOctal,
  parentDir,
} from "@/utils/format";

type FileEntry = monitor.FileEntry;
type SortProp = "name" | "size" | "modTime" | "";
type SortOrder = "" | "ascending" | "descending";

const PAGE_SIZES = [50, 100, 200, 500] as const;

export function HostFilePage({ host, tool }: { host: string; tool: Tool }) {
  if (tool === "files") return <SftpPage host={host} />;
  if (tool === "file-manager") return <FileManagerPage host={host} />;
  if (tool === "nginx") return <RemoteCodePage host={host} kind="nginx" />;
  if (tool === "apt") return <RemoteCodePage host={host} kind="apt" />;
  if (tool === "hosts") return <RemoteCodePage host={host} kind="hosts" />;
  return null;
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function normalizePath(input: string) {
  const trimmed = (input || "/").trim() || "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function FileManagerPage({ host }: { host: string }) {
  const session = useSession();

  const [loading, setLoading] = useState(false);
  const [navError, setNavError] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [cwd, setCwd] = useState("/");
  const [backStack, setBackStack] = useState<string[]>([]);
  const [forwardStack, setForwardStack] = useState<string[]>([]);

  const [addressEditing, setAddressEditing] = useState(false);
  const [addressDraft, setAddressDraft] = useState("");
  const addressInputRef = useRef<HTMLInputElement>(null);

  const [searchText, setSearchText] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [sortProp, setSortProp] = useState<SortProp>("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("");

  const [previewTarget, setPreviewTarget] = useState<{ path: string; name: string } | null>(
    null,
  );
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [actionMsg, setActionMsg] = useState("");
  const [actionErr, setActionErr] = useState("");

  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);
  const pendingPaths = useRef<string[]>([]);
  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;

  const [encodeOpen, setEncodeOpen] = useState(false);
  const [encodeItems, setEncodeItems] = useState<LocalTextCheck[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProg, setUploadProg] = useState({ uploaded: 0, total: 0, current: "" });
  const [downloading, setDownloading] = useState(false);

  const canBack = backStack.length > 0;
  const canForward = forwardStack.length > 0;

  const pathSegments = useMemo(() => {
    if (!cwd || cwd === "/") return [] as { name: string; url: string }[];
    const parts = cwd.split("/").filter(Boolean);
    const segs: { name: string; url: string }[] = [];
    let acc = "";
    for (const part of parts) {
      acc += `/${part}`;
      segs.push({ name: part, url: acc });
    }
    return segs;
  }, [cwd]);

  const uploadPercent = useMemo(() => {
    const total = uploadProg.total;
    if (!total) return 0;
    return Math.min(100, Math.round((uploadProg.uploaded / total) * 100));
  }, [uploadProg]);

  const load = useCallback(
    async (dir: string, options?: { pushHistory?: boolean }) => {
      const pushHistory = options?.pushHistory !== false;
      const from = cwdRef.current;
      if (pushHistory && dir !== from) {
        setBackStack((stack) => [...stack, from]);
        setForwardStack([]);
      }
      setLoading(true);
      setNavError("");
      try {
        const list = ((await api.listDir(host, dir)) || []) as FileEntry[];
        setEntries(list);
        setCwd(dir);
        setPage(1);
        setSelected(new Set());
        setDeleteConfirm(false);
      } catch (err) {
        setNavError(formatErr(err));
        setEntries([]);
        setActionErr(`加载失败: ${formatErr(err)}`);
      } finally {
        setLoading(false);
      }
    },
    [host],
  );

  const jump = useCallback(
    (dir: string) => {
      void load(dir);
    },
    [load],
  );

  const reload = useCallback(() => {
    void load(cwdRef.current, { pushHistory: false });
  }, [load]);

  function goBack() {
    if (!canBack) return;
    const prev = backStack[backStack.length - 1];
    setBackStack((stack) => stack.slice(0, -1));
    setForwardStack((stack) => [cwd, ...stack]);
    void load(prev, { pushHistory: false });
  }

  function goForward() {
    if (!canForward) return;
    const next = forwardStack[0];
    setForwardStack((stack) => stack.slice(1));
    setBackStack((stack) => [...stack, cwd]);
    void load(next, { pushHistory: false });
  }

  function startAddressEdit() {
    setAddressEditing(true);
    setAddressDraft(cwd);
  }

  useEffect(() => {
    if (!addressEditing) return;
    addressInputRef.current?.focus();
    addressInputRef.current?.select();
  }, [addressEditing]);

  function commitAddress() {
    setAddressEditing(false);
    const next = normalizePath(addressDraft);
    if (next !== cwd) jump(next);
  }

  async function resolveHomeDir(): Promise<string> {
    try {
      const home = await api.getHomeDir(host);
      const cleaned = (home || "").trim().replace(/\/+$/, "") || "/root";
      return cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
    } catch {
      const found = session.hosts.find((item) => item.name === host);
      const user = (found?.user || "root").trim();
      return user === "root" || !user ? "/root" : `/home/${user}`;
    }
  }

  useEffect(() => {
    let cancelled = false;
    setSearchText("");
    setAppliedSearch("");
    setSelected(new Set());
    setBackStack([]);
    setForwardStack([]);
    setPreviewTarget(null);
    setDeleteConfirm(false);
    setActionMsg("");
    setActionErr("");
    void (async () => {
      const home = await resolveHomeDir();
      if (cancelled) return;
      await load(home, { pushHistory: false });
    })();
    return () => {
      cancelled = true;
    };
    // 仅随主机切换重置；load / hosts 变化由本次挂载/切换覆盖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host]);

  const doUpload = useCallback(
    async (convertPaths: string[]) => {
      const paths = pendingPaths.current;
      if (!paths.length) return;
      setUploading(true);
      setUploadProg({ uploaded: 0, total: 0, current: "" });
      setActionErr("");
      try {
        await api.uploadPaths(host, paths, convertPaths, cwdRef.current);
        setActionMsg("上传完成");
        reload();
      } catch (err) {
        setActionErr(`上传失败: ${formatErr(err)}`);
      } finally {
        setUploading(false);
        pendingPaths.current = [];
      }
    },
    [host, reload],
  );

  const startEncodeCheck = useCallback(
    async (paths: string[]) => {
      try {
        const items = (await api.checkLocalPaths(paths)) as LocalTextCheck[];
        if (items.length > 0) {
          setEncodeItems(items);
          setEncodeOpen(true);
        } else {
          await doUpload([]);
        }
      } catch (err) {
        setActionErr(`编码检测失败: ${formatErr(err)}`);
        await doUpload([]);
      }
    },
    [doUpload],
  );

  useEffect(() => {
    const offDrop = registerFileDrop((paths) => {
      setDragOver(false);
      dragCounter.current = 0;
      if (!paths.length) return;
      pendingPaths.current = paths;
      void startEncodeCheck(paths);
    });
    const offProgress = Events.On(
      "upload:progress",
      (ev: { data?: { uploaded?: number; total?: number; current?: string } }) => {
        if (!ev?.data) return;
        setUploadProg({
          uploaded: ev.data.uploaded || 0,
          total: ev.data.total || 0,
          current: ev.data.current || "",
        });
      },
    );
    return () => {
      offDrop();
      offProgress?.();
    };
  }, [host, startEncodeCheck]);

  async function triggerUpload() {
    try {
      const result = await Dialogs.OpenFile({
        Title: "选择要上传的文件或文件夹",
        AllowsMultipleSelection: true,
        CanChooseFiles: true,
        CanChooseDirectories: true,
      });
      const paths = Array.isArray(result)
        ? result.filter(Boolean)
        : result
          ? [String(result)]
          : [];
      if (!paths.length) return;
      pendingPaths.current = paths;
      void startEncodeCheck(paths);
    } catch (err) {
      setActionErr(`选择文件失败: ${formatErr(err)}`);
    }
  }

  /** 把勾选的远端路径经 SFTP 拉到本机目录（与 XFPT 页同一套 downloadSftpPathsAs） */
  async function triggerRemoteDownload() {
    const paths = [...selected];
    if (!paths.length) {
      setActionErr("请先勾选要下载的文件或目录");
      return;
    }
    try {
      const result = await Dialogs.OpenFile({
        Title: "选择保存到的本地目录",
        AllowsMultipleSelection: false,
        CanChooseFiles: false,
        CanChooseDirectories: true,
      });
      const localDir = Array.isArray(result)
        ? String(result[0] || "")
        : result
          ? String(result)
          : "";
      if (!localDir) return;
      setDownloading(true);
      setActionErr("");
      setActionMsg("");
      await api.downloadSftpPathsAs(host, paths, localDir, "rename");
      setActionMsg(`已下载 ${paths.length} 项到 ${localDir}`);
    } catch (err) {
      setActionErr(`远程下载失败: ${formatErr(err)}`);
    } finally {
      setDownloading(false);
    }
  }

  function onDragEnter(event: ReactDragEvent) {
    event.preventDefault();
    dragCounter.current += 1;
    setDragOver(true);
  }

  function onDragLeave(event: ReactDragEvent) {
    event.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      setDragOver(false);
      dragCounter.current = 0;
    }
  }

  function onDropFallback(event: ReactDragEvent) {
    event.preventDefault();
    setDragOver(false);
    dragCounter.current = 0;
  }

  const dirNum = entries.filter((entry) => entry.isDir).length;
  const fileNum = entries.filter((entry) => !entry.isDir).length;

  const filteredSorted = useMemo(() => {
    let list = [...entries];
    const query = appliedSearch.trim().toLowerCase();
    if (query) list = list.filter((entry) => entry.name.toLowerCase().includes(query));

    if (sortProp && sortOrder) {
      const dir = sortOrder === "ascending" ? 1 : -1;
      list.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        let av: string | number = "";
        let bv: string | number = "";
        if (sortProp === "name") {
          av = a.name.toLowerCase();
          bv = b.name.toLowerCase();
        } else if (sortProp === "size") {
          av = a.size || 0;
          bv = b.size || 0;
        } else if (sortProp === "modTime") {
          av = a.modTime || "";
          bv = b.modTime || "";
        }
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return 0;
      });
    } else {
      list.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });
    }
    return list;
  }, [appliedSearch, entries, sortOrder, sortProp]);

  const pageCount = Math.max(1, Math.ceil(filteredSorted.length / pageSize) || 1);
  const safePage = Math.min(page, pageCount);
  const pageRows = filteredSorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  function applyFilter() {
    setAppliedSearch(searchText);
    setPage(1);
  }

  function cycleSort(prop: SortProp) {
    if (sortProp !== prop) {
      setSortProp(prop);
      setSortOrder("ascending");
      return;
    }
    if (sortOrder === "ascending") {
      setSortOrder("descending");
      return;
    }
    setSortProp("");
    setSortOrder("");
  }

  function sortMark(prop: SortProp) {
    if (sortProp !== prop) return "";
    if (sortOrder === "ascending") return " ↑";
    if (sortOrder === "descending") return " ↓";
    return "";
  }

  function toggleSelect(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    setDeleteConfirm(false);
  }

  function toggleSelectAllOnPage() {
    const paths = pageRows.map((row) => row.path);
    const allOn = paths.length > 0 && paths.every((path) => selected.has(path));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOn) {
        for (const path of paths) next.delete(path);
      } else {
        for (const path of paths) next.add(path);
      }
      return next;
    });
    setDeleteConfirm(false);
  }

  function onOpen(row: FileEntry) {
    if (row.isDir) jump(row.path);
    else setPreviewTarget({ path: row.path, name: row.name });
  }

  async function onDeleteSelected() {
    const rows = entries.filter((entry) => selected.has(entry.path));
    if (!rows.length) return;
    if (!deleteConfirm) {
      setDeleteConfirm(true);
      return;
    }
    setActionErr("");
    setActionMsg("");
    try {
      await api.deletePaths(
        host,
        rows.map((row) => row.path),
      );
      setActionMsg(`已删除 ${rows.length} 项`);
      setSelected(new Set());
      setDeleteConfirm(false);
      reload();
    } catch (err) {
      setActionErr(`删除失败: ${formatErr(err)}`);
    }
  }

  const pageAllSelected =
    pageRows.length > 0 && pageRows.every((row) => selected.has(row.path));

  return (
    <Page title="文件">
      <div
        data-file-drop-target
        className={`relative flex min-h-[560px] flex-col gap-3 ${dragOver ? "is-dragover" : ""}`}
        onDragEnter={onDragEnter}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={onDragLeave}
        onDrop={onDropFallback}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!canBack} title="后退" onClick={goBack}>
            ←
          </Button>
          <Button disabled={!canForward} title="前进" onClick={goForward}>
            →
          </Button>
          <Button
            disabled={cwd === "/"}
            title="上级"
            onClick={() => jump(parentDir(cwd))}
          >
            ↑
          </Button>
          <Button disabled={loading} title="刷新" onClick={reload}>
            刷新
          </Button>

          <div className="min-w-[200px] flex-1">
            {addressEditing ? (
              <input
                ref={addressInputRef}
                className="h-8 w-full rounded-control border border-line bg-canvas px-2 font-mono text-sm"
                value={addressDraft}
                onChange={(event) => setAddressDraft(event.target.value)}
                onBlur={commitAddress}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitAddress();
                  if (event.key === "Escape") {
                    setAddressEditing(false);
                    setAddressDraft(cwd);
                  }
                }}
              />
            ) : (
              <button
                type="button"
                className="flex h-8 w-full items-center gap-1 overflow-hidden rounded-control border border-line bg-surface px-2 text-left text-sm hover:bg-ink/5"
                onClick={startAddressEdit}
              >
                <span
                  className="shrink-0 text-accent"
                  onClick={(event) => {
                    event.stopPropagation();
                    jump("/");
                  }}
                >
                  /
                </span>
                {pathSegments.length === 0 ? (
                  <span className="text-muted">根目录</span>
                ) : (
                  pathSegments.map((seg, index) => (
                    <span key={seg.url} className="inline-flex min-w-0 items-center gap-1">
                      <span className="text-muted">{">"}</span>
                      <span
                        className="truncate text-accent hover:underline"
                        onClick={(event) => {
                          event.stopPropagation();
                          jump(seg.url);
                        }}
                      >
                        {index === pathSegments.length - 1
                          ? seg.name
                          : truncate(seg.name, 18)}
                      </span>
                    </span>
                  ))
                )}
              </button>
            )}
          </div>

          <div className="flex min-w-[220px] flex-1 items-center gap-1">
            <input
              className="h-8 min-w-0 flex-1 rounded-control border border-line bg-canvas px-2 text-sm"
              value={searchText}
              placeholder="在当前目录下查找"
              onChange={(event) => setSearchText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") applyFilter();
              }}
            />
            <Button onClick={applyFilter}>搜索</Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => void triggerUpload()}>
            上传
          </Button>
          <Button
            disabled={selected.size === 0 || downloading}
            onClick={() => void triggerRemoteDownload()}
          >
            {downloading ? "下载中…" : "远程下载"}
          </Button>
          <Button onClick={() => jump("/")}>/ (根目录)</Button>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {deleteConfirm ? (
              <Button
                onClick={() => {
                  setDeleteConfirm(false);
                }}
              >
                取消删除
              </Button>
            ) : null}
            <Button
              disabled={selected.size === 0}
              onClick={() => void onDeleteSelected()}
            >
              {deleteConfirm ? `确认删除 ${selected.size} 项` : "删除"}
            </Button>
          </div>
        </div>

        <p className="text-xs text-muted">
          注意：1. 搜索结果不支持排序功能 2. 文件夹无法按大小排序。
        </p>

        {navError ? <Notice text={navError} /> : null}
        {actionErr ? <Notice text={actionErr} /> : null}
        {actionMsg ? <Notice tone="warn" text={actionMsg} /> : null}

        <div className="min-h-0 flex-1 overflow-auto border border-line bg-surface">
          <table className="w-full border-collapse text-left text-sm" style={{ tableLayout: "fixed" }}>
            <thead className="bg-[#f7f8fa] text-ink">
              <tr className="h-10">
                <th className="w-10 px-2 text-center">
                  <input
                    type="checkbox"
                    checked={pageAllSelected}
                    onChange={toggleSelectAllOnPage}
                    aria-label="全选当前页"
                  />
                </th>
                <th className="w-12 px-2 text-center font-medium">序</th>
                <th
                  className="cursor-pointer px-3 font-medium"
                  onClick={() => cycleSort("name")}
                >
                  名称{sortMark("name")}
                </th>
                <th className="w-[88px] px-3 text-center font-medium">权限</th>
                <th className="w-[140px] px-3 font-medium">用户 / 用户组</th>
                <th
                  className="w-[100px] cursor-pointer px-3 text-right font-medium"
                  onClick={() => cycleSort("size")}
                >
                  大小{sortMark("size")}
                </th>
                <th
                  className="w-[168px] cursor-pointer px-3 font-medium"
                  onClick={() => cycleSort("modTime")}
                >
                  修改时间{sortMark("modTime")}
                </th>
                <th className="w-[120px] px-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && entries.length === 0 ? (
                <tr className="h-12 border-t border-line">
                  <td colSpan={8} className="px-3 text-muted">
                    加载中…
                  </td>
                </tr>
              ) : pageRows.length === 0 ? (
                <tr className="h-12 border-t border-line">
                  <td colSpan={8} className="px-3 text-muted">
                    空目录
                  </td>
                </tr>
              ) : (
                pageRows.map((row, index) => (
                  <tr
                    key={row.path}
                    className="h-12 border-t border-line hover:bg-accent/5"
                    onDoubleClick={() => onOpen(row)}
                  >
                    <td className="px-2 text-center">
                      <input
                        type="checkbox"
                        checked={selected.has(row.path)}
                        onChange={() => toggleSelect(row.path)}
                        aria-label={`选择 ${row.name}`}
                      />
                    </td>
                    <td className="px-2 text-center text-muted tabular-nums">
                      {(safePage - 1) * pageSize + index + 1}
                    </td>
                    <td className="truncate px-3">
                      <button
                        type="button"
                        className="inline-flex max-w-full items-center gap-2 text-left hover:text-accent"
                        onClick={() => onOpen(row)}
                      >
                        <span className="w-8 shrink-0 text-[11px] text-muted">
                          {row.isDir ? "目录" : "文件"}
                        </span>
                        <span className="truncate">{row.name}</span>
                      </button>
                    </td>
                    <td className="px-3 text-center font-mono text-xs text-muted">
                      {modeToOctal(row.mode) || row.mode || "—"}
                    </td>
                    <td className="truncate px-3 text-muted">
                      {row.owner || "—"} / {row.group || "—"}
                    </td>
                    <td className="px-3 text-right tabular-nums">
                      {row.isDir ? (
                        <span className="text-muted">—</span>
                      ) : (
                        formatBytes(row.size || 0)
                      )}
                    </td>
                    <td className="truncate px-3 text-muted">{row.modTime || "—"}</td>
                    <td className="px-3 text-right">
                      <div className="inline-flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => onOpen(row)}>
                          打开
                        </Button>
                        {!row.isDir ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setPreviewTarget({ path: row.path, name: row.name })
                            }
                          >
                            预览
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="text-muted">
            共 {dirNum} 个目录，{fileNum} 个文件
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted">共 {filteredSorted.length} 项</span>
            <select
              className="h-8 rounded-control border border-line bg-canvas px-2 text-sm"
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size} / 页
                </option>
              ))}
            </select>
            <Button disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              上一页
            </Button>
            <span className="tabular-nums text-muted">
              {safePage} / {pageCount}
            </span>
            <Button
              disabled={safePage >= pageCount}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            >
              下一页
            </Button>
            <input
              className="h-8 w-16 rounded-control border border-line bg-canvas px-2 text-sm tabular-nums"
              type="number"
              min={1}
              max={pageCount}
              value={safePage}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (!Number.isFinite(next)) return;
                setPage(Math.min(pageCount, Math.max(1, Math.floor(next))));
              }}
            />
          </div>
        </div>

        {dragOver ? (
          <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-surface border-2 border-dashed border-accent bg-accent/10">
            <div className="text-base font-medium text-accent">松开以上传到当前目录</div>
            <div className="font-mono text-sm text-muted">{cwd}</div>
          </div>
        ) : null}
      </div>

      <FilePreviewDrawer
        host={host}
        target={previewTarget}
        onClose={() => setPreviewTarget(null)}
      />

      <EncodeCheckDialog
        open={encodeOpen}
        items={encodeItems}
        onCancel={() => {
          setEncodeOpen(false);
          pendingPaths.current = [];
        }}
        onUploadRaw={() => {
          setEncodeOpen(false);
          void doUpload([]);
        }}
        onUploadConvert={(convertPaths) => {
          setEncodeOpen(false);
          void doUpload(convertPaths);
        }}
      />

      <Dialog open={uploading}>
        <DialogContent className="w-[min(440px,calc(100%-32px))]">
          <DialogTitle>正在上传</DialogTitle>
          <DialogDescription className="font-mono">
            {uploadProg.current || "准备中…"}
          </DialogDescription>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-line">
            <div
              className="h-full bg-accent transition-[width]"
              style={{ width: `${uploadPercent}%` }}
            />
          </div>
          <div className="mt-2 text-right text-xs text-muted">
            {formatBytes(uploadProg.uploaded)} / {formatBytes(uploadProg.total)} · {uploadPercent}%
          </div>
        </DialogContent>
      </Dialog>
    </Page>
  );
}

type Entry = { name: string; path: string; isDir: boolean; size?: number };

function normalizeEntries(raw: unknown[]): Entry[] {
  return raw
    .map((item) => {
      const row = item as { name?: string; path?: string; isDir?: boolean; size?: number };
      const path = row.path || row.name || "";
      return {
        name: row.name || path.split("/").pop() || path,
        path,
        isDir: !!row.isDir,
        size: row.size,
      };
    })
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
}

function RemoteCodePage({ host, kind }: { host: string; kind: "nginx" | "apt" | "hosts" }) {
  const [selected, setSelected] = useState("");

  const listing = useQuery({
    queryKey: ["code-list", host, kind],
    queryFn: async () => {
      if (kind === "hosts") {
        const info = await api.collectHosts(host);
        return {
          files: [{ name: "hosts", path: "/etc/hosts", content: info.raw || "" }],
          hint: "/etc/hosts",
        };
      }
      if (kind === "apt") {
        const snap = await api.collectAptSources(host);
        const files = (snap.files || []).map((file) => ({
          name: file.name || file.path,
          path: file.path,
          content: file.content || "",
        }));
        const distro = snap.distro;
        const hint = distro?.name
          ? `${distro.name}${distro.codename ? ` ${distro.codename}` : ""}`
          : "/etc/apt";
        return { files, hint, aptOnly: !!distro && !distro.apt };
      }
      const entries = normalizeEntries(await api.listDir(host, "/etc/nginx/conf.d"));
      const files = entries
        .filter((entry) => !entry.isDir && !entry.name.startsWith("."))
        .map((entry) => ({ name: entry.name, path: entry.path, content: "" }));
      return { files, hint: "/etc/nginx/conf.d" };
    },
  });

  const path = selected || listing.data?.files[0]?.path || "";
  const listed = listing.data?.files.find((file) => file.path === path);
  const needFetch = kind === "nginx" && !!path;

  const body = useQuery({
    queryKey: ["code-body", host, path],
    queryFn: () => api.readFileText(host, path),
    enabled: needFetch,
  });

  const loadedText =
    kind === "nginx"
      ? body.data || ""
      : listed?.content || (kind === "hosts" ? listing.data?.files[0]?.content || "" : "");

  const html = useMemo(() => {
    if (!loadedText) return "";
    if (kind === "nginx") {
      // conf.d 里可能混有 .json；按路径识别，其余仍按 nginx
      if (/\.jsonc?$/i.test(path)) return highlightFileHtml(loadedText, path);
      return nginxHighlightHtml(loadedText);
    }
    if (kind === "apt") return aptHighlightHtml(loadedText);
    return hostsHighlightHtml(loadedText);
  }, [kind, loadedText, path]);

  useEffect(() => {
    setSelected("");
  }, [host, kind]);

  const title = kind === "apt" ? "apt 源" : kind === "hosts" ? "Hosts" : "Nginx";

  return (
    <Page
      title={title}
      actions={
        <>
          <span className="font-mono text-sm text-muted">{listing.data?.hint || ""}</span>
          <span className="text-xs text-muted">只读预览</span>
          <Button
            onClick={() => {
              void listing.refetch();
              if (needFetch) void body.refetch();
            }}
          >
            刷新
          </Button>
        </>
      }
    >
      {listing.error ? <Notice text={formatErr(listing.error)} /> : null}
      {listing.data?.aptOnly ? <Notice tone="warn" text="仅支持 apt（Debian / Ubuntu）" /> : null}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-[220px_1fr]">
        <div className="overflow-auto rounded-surface border border-line bg-surface">
          {(listing.data?.files || []).map((file) => (
            <button
              key={file.path}
              type="button"
              className={
                file.path === path
                  ? "block w-full bg-accent/10 px-3 py-2 text-left font-mono text-[13px] text-accent"
                  : "block w-full px-3 py-2 text-left font-mono text-[13px] hover:bg-ink/5"
              }
              onClick={() => setSelected(file.path)}
            >
              {file.name}
            </button>
          ))}
          {!listing.isLoading && !(listing.data?.files || []).length ? (
            <p className="px-3 py-4 text-sm text-muted">目录为空</p>
          ) : null}
        </div>
        <div className="min-h-0 overflow-hidden rounded-surface border border-line bg-[#191c21]">
          {needFetch && body.isLoading && !loadedText ? (
            <pre className="p-4 font-mono text-sm text-[#e5e7eb]">加载中…</pre>
          ) : (
            <HighlightPane html={html} text={loadedText} />
          )}
        </div>
      </div>
    </Page>
  );
}
