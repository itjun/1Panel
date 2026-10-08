/**
 * 巡检 · HTTP 巡检：用户自己配置请求（方法 / 地址 / 参数 / 请求头 / Body）、断言与定时。
 * 点卡片立即检查并弹窗展示结果；监听 menu-check-updated，后台定时结果自动刷到卡片上。
 * 配置只存本机（menu_checks.json），仓库里不写任何业务地址。
 */
import { Events } from "@wailsio/runtime";
import { useQuery } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type main, type menucheck } from "@/api";
import { CheckEditorDialog, emptyCheckItem } from "@/react/components/inspect/check-editor";
import { Button } from "@/react/components/ui/button";
import { Card } from "@/react/components/ui/card";
import { confirmDialog } from "@/react/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/react/components/ui/dialog";
import { Tag, type TagTone } from "@/react/components/ui/tag";
import { FlashNotices, Notice, Page } from "@/react/components/page";
import { useFlashMessage } from "@/react/lib/use-flash-message";
import { copyText } from "@/utils/clipboard";
import { formatErr } from "@/utils/format";

/** 把一次检查结果合并进列表；无实质结果时只更新配置，不覆盖已有状态 */
function applyResult(
  prev: main.MenuCheckResult[],
  r: main.MenuCheckResult,
): main.MenuCheckResult[] {
  if (!r?.id) return prev;
  const idx = prev.findIndex((x) => x.id === r.id);
  if (idx < 0) return prev;
  if (r.checkedAt <= 0) {
    return prev.map((item, i) =>
      i === idx
        ? { ...item, label: r.label, method: r.method, url: r.url, config: r.config }
        : item,
    );
  }
  return prev.map((item, i) => (i === idx ? r : item));
}

/** 展示用：Query 值一律打码（可能带会话 / Token），复制时仍给完整地址 */
function maskUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const keys = [...u.searchParams.keys()];
    if (keys.length === 0) return raw;
    return `${u.origin}${u.pathname}?${keys.map((k) => `${k}=***`).join("&")}`;
  } catch {
    return raw;
  }
}

type CheckStatus = "checking" | "idle" | "ok" | "bad";

const STATUS_LABEL: Record<CheckStatus, string> = {
  checking: "检查中…",
  idle: "未检查",
  ok: "正常",
  bad: "异常",
};

const STATUS_TONE: Record<CheckStatus, TagTone> = {
  checking: "info",
  idle: "neutral",
  ok: "ok",
  bad: "danger",
};

function formatCheckedAt(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function scheduleText(c: menucheck.Item | undefined): string {
  if (!c?.scheduleEnabled) return "未开启定时";
  const every = `每 ${c.intervalMin || 5} 分钟`;
  if (c.windowStart && c.windowEnd) return `${c.windowStart}–${c.windowEnd} ${every}`;
  return `全天${every}`;
}

export function InspectPage() {
  const query = useQuery({
    queryKey: ["menu-checks"],
    queryFn: () => api.listMenuChecks(),
  });
  const flash = useFlashMessage();
  const [busyId, setBusyId] = useState("");
  const [checkingAll, setCheckingAll] = useState(false);
  const [rows, setRows] = useState<main.MenuCheckResult[]>([]);
  const [resultDialog, setResultDialog] = useState<main.MenuCheckResult | null>(null);
  const [copyHint, setCopyHint] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<menucheck.Item>(emptyCheckItem);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useEffect(() => {
    if (query.data) setRows(query.data);
  }, [query.data]);

  useEffect(() => {
    const off = Events.On("menu-check-updated", (ev: { data?: main.MenuCheckResult }) => {
      const data = ev?.data;
      if (!data?.id) return;
      setRows((prev) => applyResult(prev, data));
    });
    return () => {
      off?.();
    };
  }, []);

  const summary = useMemo(() => {
    const ok = rows.filter((item) => item.checkedAt > 0 && item.ok && item.hasData).length;
    const bad = rows.filter((item) => item.checkedAt > 0 && (!item.ok || !item.hasData)).length;
    const parts = [`共 ${rows.length} 项`];
    if (ok > 0) parts.push(`正常 ${ok}`);
    if (bad > 0) parts.push(`异常 ${bad}`);
    return parts.join(" · ");
  }, [rows]);

  async function onCopyUrl(url: string) {
    const u = url.trim();
    if (!u) return;
    try {
      await copyText(u);
      setCopyHint("已复制完整地址");
    } catch {
      setCopyHint("复制失败");
    }
  }

  /** 检查单项；showDialog 为 true 时弹出结果（全部检查时不弹） */
  async function checkOne(id: string, showDialog: boolean) {
    const before = rowsRef.current.find((item) => item.id === id);
    setBusyId(id);
    try {
      const result = await api.checkMenuPage(id);
      setRows((prev) => applyResult(prev, result));
      if (showDialog) {
        setCopyHint("");
        setResultDialog(result);
      }
    } catch (error) {
      const menuText = "请求异常：" + formatErr(error);
      const dataText = "内容异常：请求未成功，无法判断";
      const failed: main.MenuCheckResult = {
        ...(before as main.MenuCheckResult),
        id,
        ok: false,
        hasData: false,
        menuText,
        dataText,
        message: `${menuText}\n${dataText}`,
        checkedAt: Date.now(),
        scheduled: false,
      };
      setRows((prev) => applyResult(prev, failed));
      if (showDialog) {
        setCopyHint("");
        setResultDialog(failed);
      }
    } finally {
      setBusyId("");
    }
  }

  async function checkAll() {
    if (checkingAll) return;
    setCheckingAll(true);
    try {
      for (const id of rowsRef.current.map((item) => item.id)) {
        await checkOne(id, false);
      }
    } finally {
      setCheckingAll(false);
    }
  }

  function openCreate() {
    setEditing(emptyCheckItem());
    setEditorOpen(true);
  }

  function openEdit(item: main.MenuCheckResult) {
    setEditing(item.config ?? { ...emptyCheckItem(), id: item.id, label: item.label });
    setEditorOpen(true);
  }

  async function onDelete(item: main.MenuCheckResult) {
    const ok = await confirmDialog({
      title: `删除巡检「${item.label}」？`,
      body: "删除后不再定时检查，此操作不可撤销。",
      theme: "danger",
      confirmText: "删除",
    });
    if (!ok) return;
    try {
      await api.deleteMenuCheck(item.id);
      setRows((prev) => prev.filter((r) => r.id !== item.id));
      flash.showToast("已删除");
    } catch (error) {
      flash.showError(formatErr(error));
    }
  }

  function onSaved() {
    flash.showToast("已保存");
    // 后端 Latest 带最新配置 + 内存里的上次结果，直接重拉即可
    void query.refetch();
  }

  return (
    <Page
      title="HTTP 巡检"
      actions={
        <>
          <span className="text-sm text-muted">{summary}</span>
          <Button size="sm" onClick={openCreate}>
            新建巡检
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={checkingAll || rows.length === 0}
            onClick={() => void checkAll()}
          >
            {checkingAll ? "检查中…" : "全部检查"}
          </Button>
        </>
      }
    >
      <FlashNotices flash={flash} />
      {query.error ? <Notice text={formatErr(query.error)} /> : null}

      {rows.length === 0 ? (
        <Card>
          <div className="grid justify-items-start gap-3">
            <p className="text-sm text-muted">
              还没有巡检项。添加一个 HTTP 请求，设置断言和定时规则，失败时会发送系统通知和应用内消息。
            </p>
            <Button variant="primary" onClick={openCreate}>
              新建巡检
            </Button>
          </div>
        </Card>
      ) : (
        <div className="gap-card grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((item) => {
            const checked = item.checkedAt > 0;
            const isBusy = busyId === item.id;
            const status: CheckStatus = isBusy
              ? "checking"
              : !checked
                ? "idle"
                : item.ok && item.hasData
                  ? "ok"
                  : "bad";
            return (
              <div
                key={item.id}
                className={
                  isBusy
                    ? "cursor-wait bg-raised p-4 text-ink opacity-80"
                    : "motion-colors group cursor-pointer bg-raised p-4 text-ink hover:bg-line"
                }
                onClick={() => {
                  if (isBusy || checkingAll) return;
                  void checkOne(item.id, true);
                }}
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className="shrink-0 font-mono text-xs font-semibold text-accent">
                    {item.method || "GET"}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-semibold">
                    {item.label || item.title || item.id}
                  </span>
                  <Tag
                    tone={STATUS_TONE[status]}
                    className={status === "idle" ? "shrink-0 bg-surface" : "shrink-0"}
                  >
                    {STATUS_LABEL[status]}
                  </Tag>
                </div>
                <div
                  className="mb-3 truncate font-mono text-xs text-muted"
                  data-tip={maskUrl(item.url)}
                  data-tip-overflow=""
                >
                  {maskUrl(item.url)}
                </div>
                <div className="grid gap-2 text-sm">
                  <div className="flex gap-3">
                    <span className="w-10 shrink-0 text-muted">请求</span>
                    <span
                      className={
                        item.ok ? "text-success-text" : checked ? "text-danger" : "text-muted"
                      }
                    >
                      {item.menuText || "—"}
                    </span>
                  </div>
                  <div className="flex gap-3">
                    <span className="w-10 shrink-0 text-muted">内容</span>
                    <span
                      className={
                        item.hasData ? "text-success-text" : checked ? "text-danger" : "text-muted"
                      }
                    >
                      {item.dataText || "—"}
                    </span>
                  </div>
                  <div className="flex gap-3 text-xs text-muted">
                    <span className="w-10 shrink-0">定时</span>
                    <span>{scheduleText(item.config)}</span>
                  </div>
                  {checked ? (
                    <div className="flex gap-3 text-xs text-muted">
                      <span className="w-10 shrink-0">时间</span>
                      <span className="tabular-nums">{formatCheckedAt(item.checkedAt)}</span>
                    </div>
                  ) : null}
                </div>
                <div className="mt-3 flex items-center gap-1">
                  <span className="flex-1 text-xs text-muted">
                    {isBusy ? "检查中…" : "点击检查"}
                  </span>
                  <Button
                    size="sm"
                    className="w-7 bg-surface px-0 hover:bg-line"
                    aria-label="编辑"
                    data-tip="编辑"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(item);
                    }}
                  >
                    <Pencil className="size-3.5" strokeWidth={1.5} aria-hidden />
                  </Button>
                  <Button
                    size="sm"
                    className="w-7 bg-surface px-0 hover:bg-line"
                    aria-label="删除"
                    data-tip="删除"
                    onClick={(e) => {
                      e.stopPropagation();
                      void onDelete(item);
                    }}
                  >
                    <Trash2 className="size-3.5" strokeWidth={1.5} aria-hidden />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CheckEditorDialog
        open={editorOpen}
        initial={editing}
        onOpenChange={setEditorOpen}
        onSaved={onSaved}
      />

      <Dialog
        open={!!resultDialog}
        onOpenChange={(open) => {
          if (!open) setResultDialog(null);
        }}
      >
        <DialogContent className="w-[min(800px,calc(100%-32px))]">
          <DialogTitle>巡检 · {resultDialog?.label || ""}</DialogTitle>
          <DialogDescription>
            {resultDialog?.statusCode
              ? `HTTP ${resultDialog.statusCode} · ${resultDialog.durationMs} ms`
              : "本次检查结果如下"}
          </DialogDescription>

          {resultDialog ? (
            <div className="mt-4 space-y-3">
              <ResultLine ok={resultDialog.ok} text={resultDialog.menuText} />
              <ResultLine ok={resultDialog.hasData} text={resultDialog.dataText} />

              {resultDialog.url ? (
                <div className="mt-2 border-t border-line pt-4">
                  <div className="mb-2 text-xs text-muted">
                    检查地址 · {resultDialog.method || "GET"}
                  </div>
                  <div
                    className="truncate font-mono text-sm"
                    data-tip={maskUrl(resultDialog.url)}
                    data-tip-overflow=""
                  >
                    {maskUrl(resultDialog.url)}
                  </div>
                </div>
              ) : null}

              <DialogFooter>
                {copyHint ? <span className="mr-auto text-sm text-muted">{copyHint}</span> : null}
                {resultDialog.url ? (
                  <Button onClick={() => void onCopyUrl(resultDialog.url)}>复制地址</Button>
                ) : null}
                <Button variant="primary" onClick={() => setResultDialog(null)}>
                  知道了
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </Page>
  );
}

function ResultLine({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div
      className={
        ok
          ? "flex items-start gap-2 text-base text-success-text"
          : "flex items-start gap-2 text-base text-danger"
      }
    >
      <span className="shrink-0 font-semibold">{ok ? "✓" : "✕"}</span>
      <span className="min-w-0 break-words">{text}</span>
    </div>
  );
}
