import { useRef, useState, useSyncExternalStore } from "react";
import { api } from "@/api";
import { Button } from "@/react/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/react/components/ui/dialog";
import { useSession } from "@/react/state/session";
import { formatErr } from "@/utils/format";

let target: string | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export function openHostRename(host: string) {
  target = host;
  listeners.forEach((listener) => listener());
}

function closeHostRename() {
  target = null;
  listeners.forEach((listener) => listener());
}

export function HostRenameDialogHost() {
  const host = useSyncExternalStore(subscribe, () => target);
  return host ? <HostRenameDialog key={host} host={host} /> : null;
}

function HostRenameDialog({ host }: { host: string }) {
  const session = useSession();
  const [name, setName] = useState(host);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  // 保存成功后若刷新失败，重试只刷新列表，不再提交旧名称。
  const [saved, setSaved] = useState(false);
  const nextName = name.trim();

  async function save() {
    if (saving.current) return;
    if (!saved && (!nextName || nextName === host)) return;
    if (!saved && /[\s*?#!"'\\]/u.test(nextName)) {
      setError("主机名称不能包含空白、通配符、注释字符、引号或反斜杠");
      return;
    }
    saving.current = true;
    setBusy(true);
    setError("");
    let renamed = saved;
    try {
      if (!saved) {
        await api.renameHost(host, nextName);
        renamed = true;
        setSaved(true);
        session.renameHostRefs(host, nextName);
      }
      await session.refresh();
      closeHostRename();
    } catch (err) {
      setError(`${renamed ? "名称已保存，刷新失败：" : ""}${formatErr(err)}`);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving.current) closeHostRename(); }}>
      <DialogContent>
        <DialogTitle>重命名主机</DialogTitle>
        <DialogDescription>修改主机名称，并同步本地配置中的相关引用。</DialogDescription>
        <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <label className="mt-5 block text-sm" htmlFor="host-rename-name">主机名称</label>
          <input
            id="host-rename-name"
            className="motion-field mt-2 h-9 w-full rounded-control px-3 text-sm text-ink disabled:text-muted"
            value={name}
            disabled={busy || saved}
            onChange={(event) => { setName(event.target.value); setError(""); }}
            onFocus={(event) => event.currentTarget.select()}
            aria-invalid={!!error}
            aria-describedby={error ? "host-rename-error" : undefined}
            autoFocus
          />
          {error ? <p id="host-rename-error" role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={busy} onClick={closeHostRename}>取消</Button>
            <Button type="submit" variant="primary" disabled={busy || (!saved && (!nextName || nextName === host))}>
              {busy ? "保存中…" : saved ? "重新刷新" : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
