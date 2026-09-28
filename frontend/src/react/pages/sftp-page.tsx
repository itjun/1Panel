import { Events } from "@wailsio/runtime";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, type monitor } from "@/api";
import { FilePreviewDrawer } from "@/react/components/file-preview-drawer";
import { SftpPane, type SftpDeleteItem } from "@/react/components/sftp-pane";
import { ShellToolbarPortal } from "@/react/components/shell-toolbar";
import { Button } from "@/react/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/react/components/ui/dialog";
import { formatErr } from "@/utils/format";
import { registerFileDrop } from "@/utils/fileDrop";
import { getSftpLocation, saveSftpLocation, type SftpLocationState } from "@/utils/sftpLocationState";

type ConflictChoice = "overwrite" | "rename" | "cancel";

export function SftpPage({ host }: { host: string }) {
  const loc = useRef<SftpLocationState>(getSftpLocation(host));
  const hostRef = useRef(host);
  hostRef.current = host;
  const localSeq = useRef(0);
  const remoteSeq = useRef(0);
  const dragPaths = useRef<string[]>([]);
  const remoteHoverRef = useRef("");
  const gate = useRef({ asking: false, busy: false, pending: false, conflict: false });

  const [tick, setTick] = useState(0);
  const [localHeaderHost, setLocalHeaderHost] = useState<HTMLDivElement | null>(null);
  const [remoteHeaderHost, setRemoteHeaderHost] = useState<HTMLDivElement | null>(null);
  const [localEntries, setLocalEntries] = useState<monitor.FileEntry[]>([]);
  const [remoteEntries, setRemoteEntries] = useState<monitor.FileEntry[]>([]);
  const [localErr, setLocalErr] = useState("");
  const [remoteErr, setRemoteErr] = useState("");
  const [loadingLocal, setLoadingLocal] = useState(false);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [dragSide, setDragSide] = useState<"local" | "remote" | null>(null);
  const [remoteHover, setRemoteHover] = useState("");
  const [xfer, setXfer] = useState("");
  const [xferBad, setXferBad] = useState(false);
  const [pending, setPending] = useState<SftpDeleteItem[] | null>(null);
  const [confirmArmed, setConfirmArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [conflictNames, setConflictNames] = useState<string[] | null>(null);
  const conflictResolve = useRef<((choice: ConflictChoice) => void) | null>(null);
  const [previewFile, setPreviewFile] = useState<{
    path: string;
    name: string;
    source: "local" | "remote";
  } | null>(null);
  const [createKind, setCreateKind] = useState<"dir" | "file" | null>(null);
  const [createName, setCreateName] = useState("");
  const [createError, setCreateError] = useState("");

  function touch() {
    setTick((value) => value + 1);
  }

  function blocked() {
    const current = gate.current;
    return current.asking || current.busy || current.pending || current.conflict;
  }

  function flash(text: string, bad = false) {
    setXferBad(bad);
    setXfer(text);
    if (!bad) return;
    window.setTimeout(() => {
      setXfer((current) => (current === text ? "" : current));
    }, 2400);
  }

  async function loadLocalAt(path: string, record: boolean) {
    const currentHost = hostRef.current;
    const seq = ++localSeq.current;
    setLoadingLocal(true);
    setLocalErr("");
    const from = loc.current.localCwd;
    const requested = path ? normalizeLocal(path, loc.current.localHome) : "";
    if (requested && requested !== from) {
      loc.current = { ...loc.current, localCwd: requested };
      saveSftpLocation(currentHost, {
        localCwd: requested,
        localHome: loc.current.localHome,
        localBack: loc.current.localBack,
        localFwd: loc.current.localFwd,
      });
      touch();
    }
    try {
      if (!loc.current.localHome) {
        loc.current = { ...loc.current, localHome: await api.localHomeDir() };
      }
      if (seq !== localSeq.current || currentHost !== hostRef.current) return;
      const target = path ? normalizeLocal(path, loc.current.localHome) : loc.current.localHome;
      const list = (await api.listLocalDir(target)) || [];
      if (seq !== localSeq.current || currentHost !== hostRef.current) return;
      setLocalEntries(list);
      const next = pushHistory(loc.current, "local", from, target, record);
      loc.current = { ...next, localHome: loc.current.localHome, localCwd: target };
      saveSftpLocation(currentHost, {
        localHome: loc.current.localHome,
        localCwd: target,
        localBack: loc.current.localBack,
        localFwd: loc.current.localFwd,
      });
      touch();
    } catch (err) {
      if (seq !== localSeq.current || currentHost !== hostRef.current) return;
      setLocalErr(formatErr(err));
    } finally {
      if (seq === localSeq.current) setLoadingLocal(false);
    }
  }

  async function loadRemoteAt(path: string, record: boolean) {
    const currentHost = hostRef.current;
    const seq = ++remoteSeq.current;
    setLoadingRemote(true);
    setRemoteErr("");
    const from = loc.current.remoteCwd;
    const requested = path ? normalizeRemote(path) : "";
    if (requested && requested !== from) {
      loc.current = { ...loc.current, remoteCwd: requested };
      saveSftpLocation(currentHost, {
        remoteCwd: requested,
        remoteHome: loc.current.remoteHome,
        remoteBack: loc.current.remoteBack,
        remoteFwd: loc.current.remoteFwd,
      });
      touch();
    }
    try {
      await loadRemoteOnce(currentHost, path, record, from, seq);
    } catch (err) {
      if (seq !== remoteSeq.current || currentHost !== hostRef.current) return;
      if (!remoteConnDead(err)) {
        setRemoteErr(formatErr(err));
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 250));
      if (seq !== remoteSeq.current || currentHost !== hostRef.current) return;
      try {
        await loadRemoteOnce(currentHost, path, record, from, seq);
      } catch (again) {
        if (seq !== remoteSeq.current || currentHost !== hostRef.current) return;
        setRemoteErr(formatErr(again));
      }
    } finally {
      if (seq === remoteSeq.current) setLoadingRemote(false);
    }
  }

  async function loadRemoteOnce(currentHost: string, path: string, record: boolean, from: string, seq: number) {
    let target = path ? normalizeRemote(path) : "";
    if (!target) {
      target = normalizeRemote(await api.sftpHomeDir(currentHost));
      loc.current = { ...loc.current, remoteHome: target };
    }
    if (seq !== remoteSeq.current || currentHost !== hostRef.current) return;
    const list = (await api.listSftp(currentHost, target)) || [];
    if (seq !== remoteSeq.current || currentHost !== hostRef.current) return;
    setRemoteEntries(list);
    const next = pushHistory(loc.current, "remote", from, target, record);
    loc.current = { ...next, remoteHome: loc.current.remoteHome, remoteCwd: target };
    saveSftpLocation(currentHost, {
      remoteHome: loc.current.remoteHome,
      remoteCwd: target,
      remoteBack: loc.current.remoteBack,
      remoteFwd: loc.current.remoteFwd,
    });
    touch();
  }

  const confirmDeleteRef = useRef<() => void>(() => {});
  const closeDeleteRef = useRef<() => void>(() => {});
  const deletingRef = useRef(false);
  const loadLocalRef = useRef(loadLocalAt);
  const loadRemoteRef = useRef(loadRemoteAt);
  deletingRef.current = deleting;
  loadLocalRef.current = loadLocalAt;
  loadRemoteRef.current = loadRemoteAt;
  confirmDeleteRef.current = () => {
    void confirmDelete();
  };
  closeDeleteRef.current = closeDelete;

  useEffect(() => {
    localSeq.current += 1;
    remoteSeq.current += 1;
    loc.current = getSftpLocation(host);
    setLocalEntries([]);
    setRemoteEntries([]);
    setLocalErr("");
    setRemoteErr("");
    setPreviewFile(null);
    void loadLocalRef.current(loc.current.localCwd, false);
    void loadRemoteRef.current(loc.current.remoteCwd, false);
  }, [host]);

  useEffect(() => {
    const offDrop = registerFileDrop((paths) => {
      if (!paths.length || blocked()) return;
      const dir = remoteHoverRef.current || loc.current.remoteCwd;
      remoteHoverRef.current = "";
      setRemoteHover("");
      void uploadTo(paths, dir);
    });
    const offProgress = Events.On(
      "upload:progress",
      (ev: { data?: { uploaded?: number; total?: number; done?: boolean } }) => {
        if (!gate.current.busy || !ev?.data || ev.data.done) return;
        const total = ev.data.total || 0;
        if (!total) return;
        const pct = Math.min(100, Math.round(((ev.data.uploaded || 0) / total) * 100));
        setXferBad(false);
        setXfer(`正在上传 ${pct}%`);
      },
    );
    function onWinKey(event: KeyboardEvent) {
      if (conflictResolve.current) {
        if (event.key === "Escape") {
          event.preventDefault();
          pickConflict("cancel");
        }
        return;
      }
      if (!gate.current.pending || deletingRef.current) return;
      if (event.key === "Escape") {
        closeDeleteRef.current();
        return;
      }
      if (event.key !== "Enter") return;
      const tag = (event.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      event.preventDefault();
      confirmDeleteRef.current();
    }
    window.addEventListener("keydown", onWinKey);
    return () => {
      pickConflict("cancel");
      window.removeEventListener("keydown", onWinKey);
      offDrop();
      offProgress?.();
    };
    // 进度和系统拖放只跟当前这页绑定；删除确认读的是当时的状态。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host]);

  function onDragBegin(side: "local" | "remote", paths: string[]) {
    dragPaths.current = paths;
    setDragSide(side);
  }

  function onDragEnd() {
    dragPaths.current = [];
    setDragSide(null);
    remoteHoverRef.current = "";
    setRemoteHover("");
  }

  function takeDragPaths() {
    const paths = dragPaths.current.slice();
    dragPaths.current = [];
    setDragSide(null);
    return paths;
  }

  function askConflict(names: string[]): Promise<ConflictChoice> {
    gate.current.conflict = true;
    setConflictNames(names);
    return new Promise((resolve) => {
      conflictResolve.current = resolve;
    });
  }

  function pickConflict(choice: ConflictChoice) {
    const resolve = conflictResolve.current;
    conflictResolve.current = null;
    gate.current.conflict = false;
    setConflictNames(null);
    resolve?.(choice);
  }

  async function resolveMode(kind: "upload" | "download", paths: string[], dir: string): Promise<"overwrite" | "rename" | null> {
    const names = basenames(paths);
    if (!names.length) return "overwrite";
    gate.current.asking = true;
    setXferBad(false);
    setXfer("正在检查同名文件…");
    try {
      const hits = kind === "upload" ? await api.sftpExistingNames(hostRef.current, dir, names) : await api.localExistingNames(dir, names);
      setXfer("");
      if (!hits.length) return "overwrite";
      const choice = await askConflict(hits);
      if (choice === "cancel") return null;
      return choice;
    } catch (err) {
      flash(formatErr(err), true);
      return null;
    } finally {
      gate.current.asking = false;
      setXfer((current) => (current === "正在检查同名文件…" ? "" : current));
    }
  }

  async function uploadTo(paths: string[], remoteDir: string) {
    if (!paths.length || !remoteDir || blocked()) return;
    const mode = await resolveMode("upload", paths, remoteDir);
    if (!mode || gate.current.busy) return;
    gate.current.busy = true;
    setXferBad(false);
    setXfer(paths.length > 1 ? `正在上传 ${paths.length} 项…` : "正在上传…");
    try {
      await api.uploadPathsAs(hostRef.current, paths, remoteDir, mode);
      await loadRemoteRef.current(loc.current.remoteCwd, false);
      flash("已上传");
      window.setTimeout(() => setXfer((current) => (current === "已上传" ? "" : current)), 1600);
    } catch (err) {
      flash(formatErr(err), true);
    } finally {
      gate.current.busy = false;
    }
  }

  async function downloadTo(paths: string[], localDir: string) {
    if (!paths.length || !localDir || blocked()) return;
    const mode = await resolveMode("download", paths, localDir);
    if (!mode || gate.current.busy) return;
    gate.current.busy = true;
    setXferBad(false);
    setXfer(paths.length > 1 ? `正在下载 ${paths.length} 项…` : "正在下载…");
    try {
      await api.downloadSftpPathsAs(hostRef.current, paths, localDir, mode);
      await loadLocalRef.current(loc.current.localCwd, false);
      flash("已下载");
      window.setTimeout(() => setXfer((current) => (current === "已下载" ? "" : current)), 1600);
    } catch (err) {
      flash(formatErr(err), true);
    } finally {
      gate.current.busy = false;
    }
  }

  function askDelete(items: SftpDeleteItem[]) {
    if (!items.length || deleting) return;
    gate.current.pending = true;
    setConfirmArmed(false);
    setPending(items);
  }

  function closeDelete() {
    if (deleting) return;
    gate.current.pending = false;
    setPending(null);
    setConfirmArmed(false);
  }

  async function confirmDelete() {
    if (!pending || deleting) return;
    if (!confirmArmed) {
      setConfirmArmed(true);
      return;
    }
    setDeleting(true);
    try {
      await api.deleteSftpPaths(hostRef.current, pending.map((item) => item.path));
      gate.current.pending = false;
      setPending(null);
      setConfirmArmed(false);
      await loadRemoteRef.current(loc.current.remoteCwd, false);
      flash("已删除");
      window.setTimeout(() => setXfer((current) => (current === "已删除" ? "" : current)), 1600);
    } catch (err) {
      flash(formatErr(err), true);
    } finally {
      setDeleting(false);
    }
  }

  function openCreate(kind: "dir" | "file") {
    if (blocked()) return;
    setCreateKind(kind);
    setCreateName(kind === "dir" ? "新建文件夹" : "新建文件.txt");
    setCreateError("");
  }

  async function submitCreate() {
    if (!createKind) return;
    const name = createName.trim();
    if (!name) {
      setCreateError("名称不能为空");
      return;
    }
    if (name.includes("/")) {
      setCreateError("名称里不能包含 /");
      return;
    }
    const target = normalizeRemote(`${loc.current.remoteCwd}/${name}`);
    try {
      if (createKind === "dir") await api.sftpMkdir(hostRef.current, target);
      else await api.sftpCreateFile(hostRef.current, target);
      setCreateKind(null);
      await loadRemoteRef.current(loc.current.remoteCwd, false);
      flash("已创建");
      window.setTimeout(() => setXfer((current) => (current === "已创建" ? "" : current)), 1600);
    } catch (err) {
      setCreateError(formatErr(err));
    }
  }

  function goBack(side: "local" | "remote") {
    const backKey = side === "local" ? "localBack" : "remoteBack";
    const fwdKey = side === "local" ? "localFwd" : "remoteFwd";
    const cwdKey = side === "local" ? "localCwd" : "remoteCwd";
    const back = loc.current[backKey];
    if (!back.length) return;
    const prev = back[back.length - 1] || "";
    const cwd = loc.current[cwdKey];
    loc.current = {
      ...loc.current,
      [backKey]: back.slice(0, -1),
      [fwdKey]: cwd ? [...loc.current[fwdKey], cwd] : loc.current[fwdKey],
    };
    touch();
    if (side === "local") void loadLocalAt(prev, false);
    else void loadRemoteAt(prev, false);
  }

  function goForward(side: "local" | "remote") {
    const backKey = side === "local" ? "localBack" : "remoteBack";
    const fwdKey = side === "local" ? "localFwd" : "remoteFwd";
    const cwdKey = side === "local" ? "localCwd" : "remoteCwd";
    const fwd = loc.current[fwdKey];
    if (!fwd.length) return;
    const next = fwd[fwd.length - 1] || "";
    const cwd = loc.current[cwdKey];
    loc.current = {
      ...loc.current,
      [fwdKey]: fwd.slice(0, -1),
      [backKey]: cwd ? [...loc.current[backKey], cwd] : loc.current[backKey],
    };
    touch();
    if (side === "local") void loadLocalAt(next, false);
    else void loadRemoteAt(next, false);
  }

  const place = loc.current;
  const locked = blocked() || deleting || !!createKind;
  const lead = confirmArmed ? "再次确认：删除" : "确定删除";
  let confirmTitle = `${lead}这个文件？`;
  if ((pending?.length || 0) > 1) confirmTitle = `${lead}这 ${pending?.length} 项？`;
  else if (pending?.[0]?.isDir) confirmTitle = `${lead}这个文件夹？`;
  let confirmNote = "删除后无法恢复。";
  if (confirmArmed) confirmNote = "请再次确认：删除后无法恢复。";
  else if (pending?.some((item) => item.isDir)) confirmNote = "文件夹里的内容会一起删除，且无法恢复。";
  const preview = (pending || []).slice(0, 6);
  const more = Math.max(0, (pending?.length || 0) - 6);
  const conflictPreview = (conflictNames || []).slice(0, 6);
  const conflictMore = Math.max(0, (conflictNames?.length || 0) - 6);
  void tick;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ShellToolbarPortal>
        <div className="sftp-toolbar relative z-20 grid h-full w-full grid-cols-2">
          <div ref={setLocalHeaderHost} className="sftp-toolbar-local min-w-0" />
          <div ref={setRemoteHeaderHost} className="min-w-0" />
        </div>
      </ShellToolbarPortal>
      <div className="content-float gap-card relative grid min-w-0 flex-1 grid-cols-2 grid-rows-[minmax(0,1fr)] p-[var(--gap-card)]">
      <div className="surface-float h-full min-h-0 overflow-hidden">
        <SftpPane
          side="local"
          title="本机"
          cwd={place.localCwd}
          rootPath={place.localHome.startsWith("/") ? "/" : place.localHome}
          homePath={place.localHome}
          entries={localEntries}
          loading={loadingLocal}
          error={localErr}
          canBack={place.localBack.length > 0}
          canForward={place.localFwd.length > 0}
          acceptDrop={dragSide === "remote"}
          locked={locked}
          canRemove={false}
          canCreate={false}
          dropHint="松手即可下载"
          onNavigate={(path) => void loadLocalAt(path, true)}
          onBack={() => goBack("local")}
          onForward={() => goForward("local")}
          onRefresh={() => void loadLocalAt(place.localCwd, false)}
          onSend={(paths) => void uploadTo(paths, place.remoteCwd)}
          onReceive={(dir) => void downloadTo(takeDragPaths(), dir || place.localCwd)}
          onDragBegin={(paths) => onDragBegin("local", paths)}
          onDragEnd={onDragEnd}
          onOpenFile={(entry) => setPreviewFile({ path: entry.path, name: entry.name, source: "local" })}
          headerHost={localHeaderHost}
        />
      </div>
      <div className="surface-float h-full min-h-0 overflow-hidden">
        <SftpPane
          side="remote"
          title={host}
          cwd={place.remoteCwd}
          rootPath="/"
          homePath={place.remoteHome}
          entries={remoteEntries}
          loading={loadingRemote}
          error={remoteErr}
          canBack={place.remoteBack.length > 0}
          canForward={place.remoteFwd.length > 0}
          acceptDrop={dragSide === "local"}
          locked={locked}
          canRemove
          canCreate
          dropHint="松手即可上传"
          onNavigate={(path) => void loadRemoteAt(path, true)}
          onBack={() => goBack("remote")}
          onForward={() => goForward("remote")}
          onRefresh={() => void loadRemoteAt(place.remoteCwd, false)}
          onSend={(paths) => void downloadTo(paths, place.localCwd)}
          onReceive={(dir) => void uploadTo(takeDragPaths(), dir || remoteHover || place.remoteCwd)}
          onDragBegin={(paths) => onDragBegin("remote", paths)}
          onDragEnd={onDragEnd}
          onRemove={askDelete}
          onCreate={openCreate}
          onHoverTarget={(dir) => {
            remoteHoverRef.current = dir;
            setRemoteHover(dir);
          }}
          onOpenFile={(entry) => setPreviewFile({ path: entry.path, name: entry.name, source: "remote" })}
          headerHost={remoteHeaderHost}
        />
      </div>

      <FilePreviewDrawer
        host={host}
        source={previewFile?.source || "remote"}
        target={previewFile ? { path: previewFile.path, name: previewFile.name } : null}
        onClose={() => setPreviewFile(null)}
      />

      {xfer ? (
        <div className={`absolute bottom-4 left-1/2 z-[6] -translate-x-1/2 rounded-full px-3.5 py-2 text-[13px] font-semibold shadow-[0_8px_24px_rgba(0,0,0,0.18)] ${xferBad ? "bg-danger text-white" : "bg-raised text-ink"}`}>
          {xfer}
        </div>
      ) : null}

      {pending ? (
        <Modal title={confirmTitle} onClose={closeDelete}>
          {preview.map((item) => (
            <p key={item.path} className="mb-1.5 text-sm">{item.name}</p>
          ))}
          {more ? <p className="mb-1.5 text-xs text-muted">还有 {more} 项</p> : null}
          <p className="mb-1.5 text-xs text-muted">{confirmNote}</p>
          <DialogFooter>
            {confirmArmed ? (
              <Button disabled={deleting} onClick={() => setConfirmArmed(false)}>取消</Button>
            ) : null}
            <Button
              variant="danger"
              disabled={deleting}
              onClick={() => void confirmDelete()}
            >
              {deleting ? "正在删除…" : confirmArmed ? "确认删除" : "删除"}
            </Button>
          </DialogFooter>
        </Modal>
      ) : null}

      {conflictNames ? (
        <Modal title="目标里已有同名文件" onClose={() => pickConflict("cancel")}>
          {conflictPreview.map((name) => (
            <p key={name} className="mb-1.5 text-sm">{name}</p>
          ))}
          {conflictMore ? <p className="mb-1.5 text-xs text-muted">还有 {conflictMore} 项</p> : null}
          <p className="mb-1.5 text-xs text-muted">
            覆盖会替换这些文件或文件夹。保留副本会在名字后面加序号，例如 {numberedName(conflictNames[0] || "文件.pdf", 1)}，这个名字也被占用就继续用 2、3、4。
          </p>
          <DialogFooter>
            <Button onClick={() => pickConflict("cancel")}>取消</Button>
            <Button variant="primary" onClick={() => pickConflict("rename")}>保留副本</Button>
            <Button variant="danger" onClick={() => pickConflict("overwrite")}>
              覆盖
            </Button>
          </DialogFooter>
        </Modal>
      ) : null}

      {createKind ? (
        <Modal title={createKind === "dir" ? "创建目录" : "创建文件"} onClose={() => setCreateKind(null)}>
          <p className="mb-2 text-sm text-muted">{createKind === "dir" ? "目录名称" : "文件名称（创建为空文件）"}</p>
          <input
            autoFocus
            value={createName}
            className="h-8 w-full rounded-control border border-line px-2 text-sm"
            onChange={(event) => setCreateName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submitCreate();
            }}
          />
          {createError ? <p className="mt-2 text-xs text-danger">{createError}</p> : null}
          <DialogFooter>
            <Button onClick={() => setCreateKind(null)}>取消</Button>
            <Button variant="primary" onClick={() => void submitCreate()}>创建</Button>
          </DialogFooter>
        </Modal>
      ) : null}
      </div>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <div className="mt-3">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

function normalizeRemote(raw: string) {
  let value = (raw || "").trim();
  if (!value) return "/";
  if (!value.startsWith("/")) value = `/${value}`;
  value = value.replace(/\/{2,}/g, "/");
  if (value.length > 1 && value.endsWith("/")) value = value.slice(0, -1);
  return value;
}

function normalizeLocal(raw: string, home: string) {
  let value = (raw || "").trim();
  if (!value) return home || "/";
  if (value === "~") return home || value;
  if (value.startsWith("~/")) return (home || "") + value.slice(1);
  return value;
}

function pushHistory(state: SftpLocationState, side: "local" | "remote", from: string, to: string, record: boolean) {
  if (!record || !from || from === to) return state;
  if (side === "local") {
    return { ...state, localBack: [...state.localBack, from], localFwd: [] };
  }
  return { ...state, remoteBack: [...state.remoteBack, from], remoteFwd: [] };
}

function basenames(paths: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const name = path.replace(/\\/g, "/").split("/").filter(Boolean).pop() || "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

function numberedName(name: string, n: number) {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${name} ${n}`;
  return `${name.slice(0, dot)} ${n}${name.slice(dot)}`;
}

function remoteConnDead(err: unknown) {
  const text = formatErr(err).toLowerCase();
  return (
    text.includes("eof") ||
    text.includes("closed") ||
    text.includes("reset") ||
    text.includes("broken pipe") ||
    text.includes("会话创建失败") ||
    text.includes("connection lost")
  );
}
