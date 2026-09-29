/**
 * INTEGRATION:
 * - App 或 entry 里的巡检改为 import 本文件的 InspectPage
 *
 * 巡检 · 菜单检查：展示内置检查项，点击发起 Go HTTP 探活。
 * 单项检查后弹窗展示结果（查了什么、地址、可复制）；
 * 监听 menu-check-updated，后台/定时结果自动刷到卡片上。
 */
import { Events } from "@wailsio/runtime";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type main } from "@/api";
import { Button } from "@/react/components/ui/button";
import { Card } from "@/react/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/react/components/ui/dialog";
import { Tag, type TagTone } from "@/react/components/ui/tag";
import { Notice, Page } from "@/react/components/page";
import { copyText } from "@/utils/clipboard";
import { formatErr } from "@/utils/format";

/** 单项检查完成后的弹窗内容 */
type CheckResultDialog = {
  label: string;
  menuOk: boolean;
  menuText: string;
  dataOk: boolean;
  dataText: string;
  url: string;
};

/** 把一次检查结果合并进列表；无实质结果时只更新元数据，不覆盖已有状态 */
function applyMenuResult(
  prev: main.MenuCheckResult[],
  r: main.MenuCheckResult,
): main.MenuCheckResult[] {
  if (!r?.id) return prev;

  const idx = prev.findIndex((x) => x.id === r.id);
  if (idx < 0) {
    return [...prev, r];
  }

  const cur = prev[idx];
  // 快照里没有检查结果（如首次挂载只回元数据）时，不覆盖既有状态
  if (r.checkedAt <= 0 && !r.message && !r.menuText) {
    return prev.map((item, i) =>
      i === idx
        ? {
            ...item,
            label: r.label || item.label,
            url: r.url || item.url,
            title: r.title || item.title,
          }
        : item,
    );
  }

  return prev.map((item, i) =>
    i === idx
      ? {
          ...cur,
          ...r,
          label: r.label || cur.label,
          url: r.url || cur.url,
        }
      : item,
  );
}

type CheckStatus = "checking" | "idle" | "ok" | "bad";

/** 卡片右上状态标签：只让状态有颜色（DESIGN.md §1） */
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

export function InspectPage() {
  const query = useQuery({
    queryKey: ["menu-checks"],
    queryFn: () => api.listMenuChecks(),
  });
  const [busyId, setBusyId] = useState("");
  const [checkingAll, setCheckingAll] = useState(false);
  const [localRows, setLocalRows] = useState<main.MenuCheckResult[]>([]);
  const [resultDialog, setResultDialog] = useState<CheckResultDialog | null>(null);
  const [copyHint, setCopyHint] = useState("");
  // 异步检查里读最新列表，避免闭包拿到旧数据
  const rowsRef = useRef(localRows);
  rowsRef.current = localRows;

  useEffect(() => {
    if (query.data) setLocalRows(query.data);
  }, [query.data]);

  // 后台定时探活推送：直接刷卡片，不用再点一次
  useEffect(() => {
    const off = Events.On(
      "menu-check-updated",
      (ev: { data?: main.MenuCheckResult }) => {
        const data = ev?.data;
        if (!data?.id) return;
        setLocalRows((prev) => applyMenuResult(prev, data));
      },
    );
    return () => {
      off?.();
    };
  }, []);

  const summary = useMemo(() => {
    const total = localRows.length;
    const ok = localRows.filter((item) => item.ok && item.hasData).length;
    const bad = localRows.filter(
      (item) => item.checkedAt > 0 && (!item.ok || !item.hasData),
    ).length;
    const parts = [`共 ${total} 项`];
    if (ok > 0) parts.push(`正常 ${ok}`);
    if (bad > 0) parts.push(`异常 ${bad}`);
    return parts.join(" · ");
  }, [localRows]);

  function openResultDialog(
    label: string,
    menuOk: boolean,
    menuText: string,
    dataOk: boolean,
    dataText: string,
    url: string,
  ) {
    setCopyHint("");
    setResultDialog({
      label,
      menuOk,
      menuText,
      dataOk,
      dataText,
      url: (url || "").trim(),
    });
  }

  async function onCopyUrl(url: string) {
    const u = url.trim();
    if (!u) {
      setCopyHint("暂无检查地址");
      return;
    }
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
      setLocalRows((prev) => applyMenuResult(prev, result));
      if (showDialog) {
        const menuText = result.menuText || (result.ok ? "菜单正常" : "菜单异常");
        const dataText =
          result.dataText || (result.hasData ? "数据正常" : "数据异常");
        openResultDialog(
          result.label || before?.label || before?.title || id,
          !!result.ok,
          menuText,
          !!result.hasData,
          dataText,
          result.url || before?.url || "",
        );
      }
    } catch (error) {
      const menuText = "菜单异常：" + formatErr(error);
      const dataText = "数据异常：菜单不可用，无法判断";
      const failed: main.MenuCheckResult = {
        id,
        label: before?.label || id,
        url: before?.url || "",
        ok: false,
        hasData: false,
        menuText,
        dataText,
        title: before?.title || "",
        message: `${menuText}\n${dataText}`,
        checkedAt: Date.now(),
        scheduled: false,
      };
      setLocalRows((prev) => applyMenuResult(prev, failed));
      if (showDialog) {
        openResultDialog(
          failed.label,
          false,
          menuText,
          false,
          dataText,
          failed.url,
        );
      }
    } finally {
      setBusyId("");
    }
  }

  async function checkAll() {
    if (checkingAll) return;
    setCheckingAll(true);
    try {
      // 逐项检查但不逐项弹窗：结果直接落在卡片上
      const ids = rowsRef.current.map((item) => item.id);
      for (const id of ids) {
        await checkOne(id, false);
      }
    } finally {
      setCheckingAll(false);
    }
  }

  return (
    <Page
      title="菜单检查"
      actions={
        <>
          <span className="text-sm text-muted">{summary}</span>
          <Button
            size="sm"
            variant="primary"
            disabled={checkingAll}
            onClick={() => void checkAll()}
          >
            {checkingAll ? "检查中…" : "全部检查"}
          </Button>
        </>
      }
    >
      {query.error ? <Notice text={formatErr(query.error)} /> : null}

      {localRows.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            暂无巡检项（后端未返回任何菜单检查配置）
          </p>
        </Card>
      ) : (
        <div className="gap-card grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {localRows.map((item) => {
            const checked = item.checkedAt > 0;
            const isBusy = busyId === item.id;
            const status = isBusy
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
                    ? "cursor-wait rounded-control bg-raised p-5 text-ink opacity-80"
                    : "cursor-pointer rounded-control bg-raised p-5 text-ink hover:bg-line"
                }
                onClick={() => {
                  if (isBusy || checkingAll) return;
                  void checkOne(item.id, true);
                }}
              >
                <div className="mb-3 flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-semibold">
                    {item.title || item.label || item.id}
                  </span>
                  <Tag tone={STATUS_TONE[status]} className="shrink-0">
                    {STATUS_LABEL[status]}
                  </Tag>
                </div>
                <div className="grid gap-2 text-sm">
                  <div className="flex gap-3">
                    <span className="w-10 shrink-0 text-muted">菜单</span>
                    <span
                      className={
                        item.ok
                          ? "text-success-text"
                          : checked
                            ? "text-danger"
                            : "text-muted"
                      }
                    >
                      {item.menuText || "—"}
                    </span>
                  </div>
                  <div className="flex gap-3">
                    <span className="w-10 shrink-0 text-muted">数据</span>
                    <span
                      className={
                        item.hasData
                          ? "text-success-text"
                          : checked
                            ? "text-danger"
                            : "text-muted"
                      }
                    >
                      {item.dataText || "—"}
                    </span>
                  </div>
                  {item.checkedAt ? (
                    <div className="flex gap-3 text-xs text-muted">
                      <span className="w-10 shrink-0">时间</span>
                      <span>{formatCheckedAt(item.checkedAt)}</span>
                    </div>
                  ) : null}
                </div>
                <div className="mt-3 text-right text-xs text-muted">
                  {isBusy ? "检查中…" : "点击检查"}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog
        open={!!resultDialog}
        onOpenChange={(open) => {
          if (!open) setResultDialog(null);
        }}
      >
        <DialogContent className="w-[min(800px,calc(100%-32px))]">
          <DialogTitle>
            菜单检查 · {resultDialog?.label || ""}
          </DialogTitle>
          <DialogDescription>
            本次检查结果如下
          </DialogDescription>

          {resultDialog ? (
            <div className="mt-4 space-y-3">
              <div
                className={
                  resultDialog.menuOk
                    ? "flex items-start gap-2 text-base text-success-text"
                    : "flex items-start gap-2 text-base text-danger"
                }
              >
                <span className="shrink-0 font-semibold">
                  {resultDialog.menuOk ? "✓" : "✕"}
                </span>
                <span className="min-w-0 break-words">{resultDialog.menuText}</span>
              </div>
              <div
                className={
                  resultDialog.dataOk
                    ? "flex items-start gap-2 text-base text-success-text"
                    : "flex items-start gap-2 text-base text-danger"
                }
              >
                <span className="shrink-0 font-semibold">
                  {resultDialog.dataOk ? "✓" : "✕"}
                </span>
                <span className="min-w-0 break-words">{resultDialog.dataText}</span>
              </div>

              {resultDialog.url ? (
                <div className="mt-2 border-t border-line pt-4">
                  <div className="mb-2 text-xs text-muted">检查地址</div>
                  <div
                    className="truncate text-sm select-all"
                    data-tip={resultDialog.url} data-tip-overflow=""
                  >
                    {resultDialog.url}
                  </div>
                </div>
              ) : null}

              <DialogFooter>
                {copyHint ? (
                  <span className="mr-auto text-sm text-muted">{copyHint}</span>
                ) : null}
                {resultDialog.url ? (
                  <Button
                    onClick={() => void onCopyUrl(resultDialog.url)}
                  >
                    复制地址
                  </Button>
                ) : null}
                <Button
                  variant="primary"
                  onClick={() => setResultDialog(null)}
                >
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
