/**
 * 巡检项编辑弹窗：简化版 Postman。
 * 方法 + 地址 + 发送测试一行；下方页签切 Params / Headers / Body / 断言 / 定时。
 * 「发送测试」用当前草稿直接请求，不保存、不告警。
 */
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type main, type menucheck } from "@/api";
import { Button } from "@/react/components/ui/button";
import { Checkbox } from "@/react/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/react/components/ui/dialog";
import { InputNumber } from "@/react/components/ui/input-number";
import { RadioGroup } from "@/react/components/ui/radio-group";
import { Select } from "@/react/components/ui/select";
import { Switch } from "@/react/components/ui/switch";
import { Tag } from "@/react/components/ui/tag";
import { Notice } from "@/react/components/page";
import { formatErr } from "@/utils/format";

const FIELD = "motion-field h-8 w-full rounded-control px-3 text-sm text-ink";
const AREA =
  "motion-field w-full resize-y rounded-control px-3 py-2 font-mono text-xs text-ink";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const CUSTOM_METHOD = "__custom__";

type Tab = "params" | "headers" | "body" | "assert" | "schedule";

export function emptyCheckItem(): menucheck.Item {
  return {
    id: "",
    label: "",
    method: "GET",
    url: "",
    query: [],
    headers: [],
    body: "",
    timeoutSec: 20,
    expectStatus: "",
    mustContain: [],
    mustNotContain: [],
    scheduleEnabled: false,
    intervalMin: 5,
    windowStart: "",
    windowEnd: "",
  };
}

function normalizeDraft(item: menucheck.Item): menucheck.Item {
  return {
    ...emptyCheckItem(),
    ...item,
    query: item.query ?? [],
    headers: item.headers ?? [],
    mustContain: item.mustContain ?? [],
    mustNotContain: item.mustNotContain ?? [],
  };
}

function linesOf(text: string): string[] {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function CheckEditorDialog({
  open,
  initial,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  /** 编辑时传已有配置；新建传 emptyCheckItem() */
  initial: menucheck.Item;
  onOpenChange: (open: boolean) => void;
  onSaved: (item: menucheck.Item) => void;
}) {
  const [draft, setDraft] = useState<menucheck.Item>(() => normalizeDraft(initial));
  const [customMethod, setCustomMethod] = useState(false);
  const [mustText, setMustText] = useState("");
  const [mustNotText, setMustNotText] = useState("");
  const [useWindow, setUseWindow] = useState(false);
  const [tab, setTab] = useState<Tab>("params");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<main.MenuCheckResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const d = normalizeDraft(initial);
    setDraft(d);
    setCustomMethod(!!d.method && !METHODS.includes(d.method));
    setMustText((d.mustContain ?? []).join("\n"));
    setMustNotText((d.mustNotContain ?? []).join("\n"));
    setUseWindow(!!(d.windowStart || d.windowEnd));
    setTab("params");
    setTestResult(null);
    setError("");
  }, [open, initial]);

  function patch(p: Partial<menucheck.Item>) {
    setDraft((prev) => ({ ...prev, ...p }));
  }

  /** 把文本框、时间窗开关等局部状态合并成最终提交的配置 */
  function collect(): menucheck.Item {
    return {
      ...draft,
      method: (draft.method || "GET").trim().toUpperCase(),
      mustContain: linesOf(mustText),
      mustNotContain: linesOf(mustNotText),
      windowStart: useWindow ? draft.windowStart.trim() : "",
      windowEnd: useWindow ? draft.windowEnd.trim() : "",
    };
  }

  async function onTest() {
    if (testing) return;
    setTesting(true);
    setError("");
    try {
      setTestResult(await api.testMenuCheck(collect()));
    } catch (e) {
      setError(formatErr(e));
    } finally {
      setTesting(false);
    }
  }

  async function onSave() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const saved = await api.saveMenuCheck(collect());
      onSaved(saved);
      onOpenChange(false);
    } catch (e) {
      setError(formatErr(e));
    } finally {
      setSaving(false);
    }
  }

  const enabledCount = (rows: menucheck.KV[] | null) =>
    (rows ?? []).filter((r) => r.enabled && r.key.trim()).length;
  const tabLabel = (name: string, n: number) => (n > 0 ? `${name} (${n})` : name);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(840px,calc(100vw-32px))]">
        <DialogTitle>{draft.id ? "编辑巡检" : "新建巡检"}</DialogTitle>
        <DialogDescription>
          配置只保存在本机，不会写入项目代码。
        </DialogDescription>

        <div className="mt-4 grid gap-4">
          <label className="grid gap-1.5">
            <span className="text-sm text-muted">名称</span>
            <input
              className={FIELD}
              placeholder="如：订单接口"
              value={draft.label}
              onChange={(e) => patch({ label: e.target.value })}
            />
          </label>

          <div className="flex items-center gap-2">
            <Select
              className="w-28 shrink-0"
              aria-label="请求方法"
              value={customMethod ? CUSTOM_METHOD : draft.method || "GET"}
              options={[
                ...METHODS.map((m) => ({ value: m, label: m })),
                { value: CUSTOM_METHOD, label: "自定义…" },
              ]}
              onChange={(v) => {
                if (v === CUSTOM_METHOD) {
                  setCustomMethod(true);
                  patch({ method: "" });
                } else {
                  setCustomMethod(false);
                  patch({ method: v });
                }
              }}
            />
            {customMethod ? (
              <input
                className={`${FIELD} w-28 shrink-0 font-mono uppercase`}
                aria-label="自定义方法"
                placeholder="方法"
                value={draft.method}
                onChange={(e) => patch({ method: e.target.value.toUpperCase() })}
              />
            ) : null}
            <input
              className={`${FIELD} min-w-0 flex-1 font-mono`}
              aria-label="请求地址"
              placeholder="https://example.com/api/health"
              value={draft.url}
              onChange={(e) => patch({ url: e.target.value })}
            />
            <Button
              variant="primary"
              className="shrink-0"
              disabled={testing || !draft.url.trim()}
              onClick={() => void onTest()}
            >
              {testing ? "发送中…" : "发送测试"}
            </Button>
          </div>

          <RadioGroup<Tab>
            aria-label="配置分类"
            value={tab}
            onChange={setTab}
            options={[
              { value: "params", label: tabLabel("Params", enabledCount(draft.query)) },
              { value: "headers", label: tabLabel("Headers", enabledCount(draft.headers)) },
              { value: "body", label: "Body" },
              { value: "assert", label: "断言" },
              { value: "schedule", label: draft.scheduleEnabled ? "定时 · 开" : "定时" },
            ]}
          />

          <div className="min-h-[176px]">
            {tab === "params" ? (
              <KvEditor
                rows={draft.query ?? []}
                keyPlaceholder="参数名"
                onChange={(query) => patch({ query })}
              />
            ) : null}
            {tab === "headers" ? (
              <KvEditor
                rows={draft.headers ?? []}
                keyPlaceholder="如 Authorization"
                onChange={(headers) => patch({ headers })}
              />
            ) : null}
            {tab === "body" ? (
              <div className="grid gap-1.5">
                <textarea
                  className={AREA}
                  rows={8}
                  aria-label="请求体"
                  placeholder='原文发送，如 {"key":"value"}'
                  value={draft.body}
                  onChange={(e) => patch({ body: e.target.value })}
                />
                <span className="text-xs text-muted">
                  Content-Type 请在 Headers 里填写，例如 application/json。
                </span>
              </div>
            ) : null}
            {tab === "assert" ? (
              <div className="grid gap-4">
                <div className="grid grid-cols-[120px_1fr] items-center gap-x-4 gap-y-3">
                  <span className="text-sm text-muted">期望状态码</span>
                  <div className="flex items-center gap-3">
                    <input
                      className={`${FIELD} w-48 font-mono`}
                      placeholder="2xx/3xx"
                      value={draft.expectStatus}
                      onChange={(e) => patch({ expectStatus: e.target.value })}
                    />
                    <span className="text-xs text-muted">
                      示例：200、2xx、200,204；留空表示 2xx 或 3xx 都算正常
                    </span>
                  </div>
                  <span className="text-sm text-muted">超时（秒）</span>
                  <InputNumber
                    className="w-36"
                    aria-label="超时秒数"
                    min={1}
                    max={120}
                    value={draft.timeoutSec || 20}
                    onCommit={(timeoutSec) => patch({ timeoutSec })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <label className="grid gap-1.5">
                    <span className="text-sm text-muted">响应必须包含（每行一条）</span>
                    <textarea
                      className={AREA}
                      rows={5}
                      placeholder={'如 "code":0'}
                      value={mustText}
                      onChange={(e) => setMustText(e.target.value)}
                    />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-sm text-muted">响应不得包含（每行一条）</span>
                    <textarea
                      className={AREA}
                      rows={5}
                      placeholder="如 请重新登录"
                      value={mustNotText}
                      onChange={(e) => setMustNotText(e.target.value)}
                    />
                  </label>
                </div>
              </div>
            ) : null}
            {tab === "schedule" ? (
              <div className="grid grid-cols-[120px_1fr] items-center gap-x-4 gap-y-4">
                <span className="text-sm text-muted">定时检查</span>
                <Switch
                  checked={draft.scheduleEnabled}
                  onChange={(scheduleEnabled) => patch({ scheduleEnabled })}
                >
                  <span className="text-xs text-muted">
                    失败时发送系统通知和应用内消息，每次失败都会提醒
                  </span>
                </Switch>
                <span className="text-sm text-muted">间隔（分钟）</span>
                <InputNumber
                  className="w-36"
                  aria-label="间隔分钟"
                  min={1}
                  max={1440}
                  disabled={!draft.scheduleEnabled}
                  value={draft.intervalMin || 5}
                  onCommit={(intervalMin) => patch({ intervalMin })}
                />
                <span className="text-sm text-muted">每日时间段</span>
                <div className="flex flex-wrap items-center gap-3">
                  <Switch
                    checked={useWindow}
                    disabled={!draft.scheduleEnabled}
                    onChange={(on) => {
                      setUseWindow(on);
                      if (on && !draft.windowStart && !draft.windowEnd) {
                        patch({ windowStart: "09:00", windowEnd: "18:00" });
                      }
                    }}
                  />
                  {useWindow ? (
                    <>
                      <input
                        className={`${FIELD} w-24 text-center font-mono tabular-nums`}
                        aria-label="开始时间"
                        placeholder="18:00"
                        disabled={!draft.scheduleEnabled}
                        value={draft.windowStart}
                        onChange={(e) => patch({ windowStart: e.target.value })}
                      />
                      <span className="text-sm text-muted">至</span>
                      <input
                        className={`${FIELD} w-24 text-center font-mono tabular-nums`}
                        aria-label="结束时间"
                        placeholder="20:00"
                        disabled={!draft.scheduleEnabled}
                        value={draft.windowEnd}
                        onChange={(e) => patch({ windowEnd: e.target.value })}
                      />
                      <span className="text-xs text-muted">结束早于开始表示跨零点</span>
                    </>
                  ) : (
                    <span className="text-xs text-muted">关闭时全天按间隔检查</span>
                  )}
                </div>
              </div>
            ) : null}
          </div>

          {testResult ? <TestResultPanel result={testResult} /> : null}
          {error ? <Notice text={error} /> : null}
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>取消</Button>
          <Button variant="primary" disabled={saving} onClick={() => void onSave()}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KvEditor({
  rows,
  keyPlaceholder,
  onChange,
}: {
  rows: menucheck.KV[];
  keyPlaceholder: string;
  onChange: (rows: menucheck.KV[]) => void;
}) {
  function update(i: number, p: Partial<menucheck.KV>) {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  }
  return (
    <div className="grid gap-2">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <Checkbox
            aria-label="启用"
            checked={row.enabled}
            onChange={(enabled) => update(i, { enabled })}
          />
          <input
            className={`${FIELD} w-56 shrink-0 font-mono`}
            placeholder={keyPlaceholder}
            value={row.key}
            onChange={(e) => update(i, { key: e.target.value })}
          />
          <input
            className={`${FIELD} min-w-0 flex-1 font-mono`}
            placeholder="值"
            value={row.value}
            onChange={(e) => update(i, { value: e.target.value })}
          />
          <Button
            variant="ghost"
            className="w-8 shrink-0 px-0"
            aria-label="删除这一行"
            data-tip="删除这一行"
            onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
          >
            <Trash2 className="size-4" strokeWidth={1.5} aria-hidden />
          </Button>
        </div>
      ))}
      <div>
        <Button
          size="sm"
          onClick={() => onChange([...rows, { key: "", value: "", enabled: true }])}
        >
          <Plus className="size-3.5" strokeWidth={1.5} aria-hidden />
          添加一行
        </Button>
      </div>
    </div>
  );
}

function TestResultPanel({ result }: { result: main.MenuCheckResult }) {
  const passed = result.ok && result.hasData;
  return (
    <div className="grid gap-2 rounded-panel bg-raised p-4">
      <div className="flex items-center gap-2 text-sm">
        <Tag tone={passed ? "ok" : "danger"}>{passed ? "通过" : "未通过"}</Tag>
        {result.statusCode ? (
          <span className="font-mono tabular-nums text-muted">
            HTTP {result.statusCode} · {result.durationMs} ms
          </span>
        ) : null}
      </div>
      <div className={result.ok ? "text-sm text-success-text" : "text-sm text-danger"}>
        {result.menuText}
      </div>
      <div className={result.hasData ? "text-sm text-success-text" : "text-sm text-danger"}>
        {result.dataText}
      </div>
      {result.bodyPreview ? (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-control bg-surface p-3 font-mono text-xs text-ink">
          {result.bodyPreview}
        </pre>
      ) : null}
    </div>
  );
}
