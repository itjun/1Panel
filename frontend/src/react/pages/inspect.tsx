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
  DialogTitle,
} from "@/react/components/ui/dialog";
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
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
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
              <Card
                key={item.id}
                className={
                  isBusy
                    ? "cursor-wait opacity-80"
                    : "cursor-pointer hover:border-accent/40"
                }
                onClick={() => {
                  if (isBusy || checkingAll) return;
                  void checkOne(item.id, true);
                }}
              >
                <div className="mb-3 flex items-center gap-2">
                  <span
                    className={
                      status === "ok"
                        ? "h-2.5 w-2.5 rounded-full bg-[#1f7a3f]"
                        : status === "bad"
                          ? "h-2.5 w-2.5 rounded-full bg-[#a83232]"
                          : status === "checking"
                            ? "h-2.5 w-2.5 animate-pulse rounded-full bg-accent"
                            : "h-2.5 w-2.5 rounded-full bg-line"
                    }
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {item.title || item.label || item.id}
                  </span>
                  <span className="shrink-0 text-xs text-muted">
                    {status === "checking"
                      ? "检查中…"
                      : status === "ok"
                        ? "正常"
                        : status === "bad"
                          ? "异常"
                          : "未检查"}
                  </span>
                </div>
                <div className="grid gap-2 text-sm">
                  <div className="flex gap-3">
                    <span className="w-10 shrink-0 text-muted">菜单</span>
                    <span
                      className={
                        item.ok
                          ? "text-[#1f7a3f]"
                          : checked
                            ? "text-[#a83232]"
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
                          ? "text-[#1f7a3f]"
                          : checked
                            ? "text-[#a83232]"
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
              </Card>
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
                    ? "flex items-start gap-2 text-base text-[#1f7a3f]"
                    : "flex items-start gap-2 text-base text-[#a83232]"
                }
              >
                <span className="shrink-0 font-bold">
                  {resultDialog.menuOk ? "✓" : "❌"}
                </span>
                <span className="min-w-0 break-words">{resultDialog.menuText}</span>
              </div>
              <div
                className={
                  resultDialog.dataOk
                    ? "flex items-start gap-2 text-base text-[#1f7a3f]"
                    : "flex items-start gap-2 text-base text-[#a83232]"
                }
              >
                <span className="shrink-0 font-bold">
                  {resultDialog.dataOk ? "✓" : "❌"}
                </span>
                <span className="min-w-0 break-words">{resultDialog.dataText}</span>
              </div>

              {resultDialog.url ? (
                <div className="mt-2 border-t border-line pt-4">
                  <div className="mb-2 text-xs text-muted">检查地址</div>
                  <div
                    className="truncate text-sm select-all"
                    title={resultDialog.url}
                  >
                    {resultDialog.url}
                  </div>
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
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
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </Page>
  );
}
