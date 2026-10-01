import { Copy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/api";
import { PreviewMatrix, type PreviewRow } from "@/react/components/notify/channel-preview";
import { FlashNotices, Page } from "@/react/components/page";
import { Button } from "@/react/components/ui/button";
import { Checkbox } from "@/react/components/ui/checkbox";
import { InputNumber } from "@/react/components/ui/input-number";
import { RadioGroup } from "@/react/components/ui/radio-group";
import { Switch } from "@/react/components/ui/switch";
import { useFlashMessage } from "@/react/lib/use-flash-message";
import { useSession } from "@/react/state/session";
import {
  ALERT_REPEAT_RANGE,
  ALERT_SUSTAIN_RANGE,
  updateSettings,
  useSettings,
  type AlertContentKind,
  type NotifyContentField,
} from "@/react/state/settings";
import {
  ALERT_KIND_LABEL,
  ALERT_RULES,
  alertRuleText,
  alertThresholdText,
  isResourceAlertKind,
  LEVEL_LABEL,
  levelPercent,
  LOAD_WINDOW_LABEL,
  normalizeAlertLevels,
  RESOURCE_POLL_MS,
  type AlertCondition,
  type AlertStartLevel,
  type LoadWindow,
  type ResourceAlertKind,
} from "@/utils/alerts";
import { copyText } from "@/utils/clipboard";
import { formatErr } from "@/utils/format";
import { buildNotifyMessage, type NotifyTextParts } from "@/utils/notifyMessage";

const WECOM_WEBHOOK_PREFIX = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=";

/** 只填 key 时补成完整 URL，便于复制和测试 */
function expandWecomWebhook(raw: string): string {
  const v = (raw || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  return WECOM_WEBHOOK_PREFIX + v;
}

const CHANNELS = [
  {
    key: "systemNotifyEnabled",
    label: "系统通知",
    desc: "弹出系统通知横幅，点开直接定位到这条消息",
  },
  {
    key: "inAppNotifyEnabled",
    label: "应用内",
    desc: "记进「指标消息 / 应用消息」，侧栏显示未读数",
  },
  {
    key: "notifyEnabled",
    label: "企业微信",
    desc: "发到企业微信群机器人，需要下方的地址",
  },
] as const;

const FIELD_LABEL: Record<NotifyContentField, string> = {
  hostName: "主机名",
  metric: "指标",
  threshold: "阈值",
  value: "当前值",
  service: "服务",
};

const FIELD_ORDER: NotifyContentField[] = ["hostName", "metric", "service", "value", "threshold"];

const POLL_SECONDS = RESOURCE_POLL_MS / 1000;

const CONTENT_RULES: { kind: AlertContentKind; name: string; desc?: string }[] = [
  ...ALERT_RULES.map((rule) => ({ kind: rule.kind as AlertContentKind, name: rule.name })),
  { kind: "app", name: "应用探活", desc: "进程、健康检查、入口任一失败时告警" },
  { kind: "cert", name: "证书到期", desc: "每天 06:00 扫描 /etc/nginx/cert，剩余不足 30 天每天提醒一次" },
];

type SampleKind = ResourceAlertKind | "app";

const SAMPLE_OPTIONS: { value: SampleKind; label: string }[] = [
  ...ALERT_RULES.map((rule) => ({ value: rule.kind as SampleKind, label: rule.name })),
  { value: "app", label: "应用探活" },
];

const LEVEL_ORDER: AlertStartLevel[] = ["warn", "danger"];

const LOAD_WINDOW_OPTIONS = (["load1", "load5", "load15"] as const).map((value) => ({
  value,
  label: LOAD_WINDOW_LABEL[value],
}));

type SampleReading = { text: string; condition?: AlertCondition };

/** 预览用的示例读数：警告档读数、危险档读数（也当峰值）、回落值 */
function sampleReadings(
  kind: ResourceAlertKind,
  loadWindow: LoadWindow,
): { warn: SampleReading; danger: SampleReading; recovered: SampleReading } {
  switch (kind) {
    case "cpu":
      return { warn: { text: "64.2%" }, danger: { text: "91.3%" }, recovered: { text: "42.1%" } };
    case "mem":
      return { warn: { text: "67.5%" }, danger: { text: "88.2%" }, recovered: { text: "52.4%" } };
    case "disk":
      return {
        warn: { text: "/data 已用 63.8%（可用 72 GB）" },
        danger: { text: "/data 可用 8 GB（已用 96.0%）", condition: "avail" },
        recovered: { text: "/data 已用 51.0%（可用 98 GB）" },
      };
    case "load":
      return {
        warn: { text: `${loadWindow} 5.12 / 8 核（64%）` },
        danger: { text: `${loadWindow} 7.20 / 8 核（90%）` },
        recovered: { text: `${loadWindow} 3.36 / 8 核（42%）` },
      };
    case "net":
      return {
        warn: { text: "发送 82.4 MB/s（66%）" },
        danger: { text: "发送 113.0 MB/s（90%）" },
        recovered: { text: "发送 12.6 MB/s（10%）" },
      };
    case "diskio":
      return {
        warn: { text: "写入 136.0 MB/s（68%）" },
        danger: { text: "写入 182.0 MB/s（91%）" },
        recovered: { text: "写入 24.0 MB/s（12%）" },
      };
  }
}

export function SetupPage() {
  const settings = useSettings();
  const session = useSession();
  const flash = useFlashMessage();
  const [webhookDraft, setWebhookDraft] = useState(settings.wecomWebhook);
  const [saving, setSaving] = useState(false);

  // 设置里地址被别处改过时，同步草稿
  useEffect(() => {
    setWebhookDraft(settings.wecomWebhook);
  }, [settings.wecomWebhook]);

  const draftExpanded = expandWecomWebhook(webhookDraft);
  const savedExpanded = expandWecomWebhook(settings.wecomWebhook);
  const webhookDirty = draftExpanded !== savedExpanded;

  async function testAndSave() {
    if (!draftExpanded) {
      updateSettings({ wecomWebhook: "" });
      flash.showToast("已清除企业微信地址");
      return;
    }
    setSaving(true);
    try {
      await api.testWecomWebhook(draftExpanded);
      updateSettings({ wecomWebhook: draftExpanded });
      setWebhookDraft(draftExpanded);
      flash.showToast("测试消息已发到群里，地址已保存");
    } catch (error) {
      flash.showError(`测试失败，地址没有保存：${formatErr(error)}`);
    } finally {
      setSaving(false);
    }
  }

  const sampleHost = useMemo(() => {
    const subscribed = Object.keys(settings.hostResourceNotifySubs).find(
      (host) => (settings.hostResourceNotifySubs[host] || []).length > 0,
    );
    return subscribed || session.hosts[0]?.name || "web-01";
  }, [session.hosts, settings.hostResourceNotifySubs]);

  const previewRows = useMemo<PreviewRow[]>(() => {
    const rows: PreviewRow[] = [];
    for (const option of SAMPLE_OPTIONS) {
      const contentKind: AlertContentKind = option.value === "app" ? "app" : option.value;
      const kindOff = !settings.alertContentKinds.includes(contentKind);
      for (const state of ["down", "up"] as const) {
        const up = state === "up";
        let muted = "";
        if (kindOff) muted = "未勾选，不会发送";
        else if (up && !settings.notifyRecoverEnabled) muted = "「恢复」未勾选";
        if (option.value === "app") {
          const parts: NotifyTextParts = {
            hostName: sampleHost,
            service: "im",
            metric: "应用探活",
            value: up ? "探活已恢复" : "健康检查失败",
          };
          rows.push({
            key: `app-${state}`,
            name: option.label,
            host: sampleHost,
            kind: "app:im",
            state,
            muted,
            message: buildNotifyMessage({ state, kind: "app", parts, fields: settings.notifyContentFields }),
          });
          continue;
        }
        const kind = option.value;
        const levels = normalizeAlertLevels(settings.alertLevels[kind]);
        const start = levels[0];
        const sample = sampleReadings(kind, settings.alertLoadWindow);
        const base = { name: option.label, host: sampleHost, kind, state, muted };
        const fields = settings.notifyContentFields;
        const partsFor = (level: AlertStartLevel, reading: SampleReading, peak?: SampleReading): NotifyTextParts => ({
          hostName: sampleHost,
          metric: ALERT_KIND_LABEL[kind],
          threshold: alertThresholdText(kind, level, reading.condition),
          value: reading.text,
          peak: peak?.text,
        });
        if (up) {
          rows.push({
            ...base,
            key: `${kind}-up`,
            message: buildNotifyMessage({
              state,
              kind: "resource",
              parts: partsFor(start, sample.recovered, sample.danger),
              fields,
              level: "danger",
            }),
          });
          continue;
        }
        rows.push({
          ...base,
          key: `${kind}-down`,
          message: buildNotifyMessage({
            state,
            kind: "resource",
            parts: partsFor(start, sample[start]),
            fields,
            level: start,
          }),
        });
        if (levels.length > 1) {
          rows.push({
            ...base,
            key: `${kind}-escalate`,
            stage: "升级",
            message: buildNotifyMessage({
              state,
              kind: "resource",
              parts: partsFor("danger", sample.danger),
              fields,
              level: "danger",
              escalated: true,
            }),
          });
        }
        if (settings.alertRepeatMinutes > 0) {
          const level = levels.length > 1 ? "danger" : start;
          rows.push({
            ...base,
            key: `${kind}-repeat`,
            stage: "重复",
            message: buildNotifyMessage({
              state,
              kind: "resource",
              parts: partsFor(level, sample[level]),
              fields,
              level,
              repeatMs: settings.alertRepeatMinutes * 60_000,
            }),
          });
        }
      }
    }
    return rows;
  }, [
    sampleHost,
    settings.alertContentKinds,
    settings.alertLevels,
    settings.alertLoadWindow,
    settings.alertRepeatMinutes,
    settings.notifyContentFields,
    settings.notifyRecoverEnabled,
  ]);

  function toggleContentKind(kind: AlertContentKind, checked: boolean) {
    const next = checked
      ? [...settings.alertContentKinds, kind]
      : settings.alertContentKinds.filter((item) => item !== kind);
    updateSettings({ alertContentKinds: next });
  }

  function toggleField(field: NotifyContentField, checked: boolean) {
    const next = checked
      ? [...settings.notifyContentFields, field]
      : settings.notifyContentFields.filter((item) => item !== field);
    updateSettings({ notifyContentFields: next });
  }

  return (
    <Page title="通知设置">
      <FlashNotices flash={flash} />
      <div className="gap-section flex flex-col">
        <div className="gap-section flex w-full max-w-[640px] flex-col">
          <section>
            <h2 className="mb-3 text-sm font-semibold text-ink">送到哪里</h2>
            <div className="flex flex-col gap-3">
              {CHANNELS.map((channel) => (
                <div key={channel.key} className="grid grid-cols-[120px_1fr] items-center gap-4">
                  <Switch
                    checked={settings[channel.key]}
                    onChange={(checked) => {
                      if (channel.key === "systemNotifyEnabled") updateSettings({ systemNotifyEnabled: checked });
                      else if (channel.key === "inAppNotifyEnabled") updateSettings({ inAppNotifyEnabled: checked });
                      else updateSettings({ notifyEnabled: checked });
                    }}
                  >
                    {channel.label}
                  </Switch>
                  <span className="text-xs text-muted">{channel.desc}</span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-ink">企业微信地址</h2>
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <input
                  className="motion-field h-8 w-full rounded-control pr-9 pl-3 disabled:opacity-50"
                  value={webhookDraft}
                  disabled={!settings.notifyEnabled}
                  placeholder="粘贴完整 Webhook 地址，或只填 key"
                  aria-label="企业微信 Webhook 地址"
                  onChange={(event) => setWebhookDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && webhookDirty && !saving) void testAndSave();
                  }}
                />
                <button
                  type="button"
                  aria-label="复制完整地址"
                  data-tip="复制完整地址"
                  disabled={!settings.notifyEnabled || !draftExpanded}
                  onClick={() => {
                    void copyText(draftExpanded)
                      .then(() => flash.showToast("已复制完整地址"))
                      .catch(() => flash.showError("复制失败"));
                  }}
                  className="motion-colors absolute top-1 right-1 inline-flex size-6 items-center justify-center rounded-control text-muted hover:bg-line hover:text-ink focus-visible:outline-2 focus-visible:outline-accent-focus disabled:pointer-events-none disabled:opacity-50"
                >
                  <Copy size={16} strokeWidth={1.5} aria-hidden />
                </button>
              </div>
              <Button
                variant="primary"
                disabled={!settings.notifyEnabled || !webhookDirty || saving}
                onClick={() => void testAndSave()}
              >
                {draftExpanded || !savedExpanded ? "测试并保存" : "清除地址"}
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted">
              {!settings.notifyEnabled
                ? "打开上方「企业微信」后才能填写。"
                : webhookDirty
                  ? "保存前会先往群里发一条测试消息，发送成功才保存。"
                  : savedExpanded
                    ? "地址已保存。"
                    : "还没有填写地址，企业微信消息不会发送。"}
            </p>
          </section>

          <section>
            <h2 className="mb-1 text-sm font-semibold text-ink">通知什么</h2>
            <p className="mb-3 text-xs text-muted">
              只对订阅了的主机生效，订阅在「指标订阅」「应用订阅」里按主机勾选。
            </p>
            <div className="grid grid-cols-[120px_1fr] items-center gap-x-4 gap-y-3">
              {CONTENT_RULES.map((rule) => (
                <div key={rule.kind} className="contents">
                  <Checkbox
                    checked={settings.alertContentKinds.includes(rule.kind)}
                    onChange={(checked) => toggleContentKind(rule.kind, checked)}
                  >
                    {rule.name}
                  </Checkbox>
                  {isResourceAlertKind(rule.kind) ? (
                    <ResourceRuleRow
                      kind={rule.kind}
                      loadWindow={settings.alertLoadWindow}
                      levels={normalizeAlertLevels(settings.alertLevels[rule.kind])}
                      disabled={!settings.alertContentKinds.includes(rule.kind)}
                      onChange={(levels) =>
                        updateSettings({ alertLevels: { ...settings.alertLevels, [rule.kind]: levels } })
                      }
                    />
                  ) : (
                    <span className="text-xs text-muted">{rule.desc}</span>
                  )}
                </div>
              ))}
              <Checkbox
                checked={settings.notifyRecoverEnabled}
                onChange={(checked) => updateSettings({ notifyRecoverEnabled: checked })}
              >
                恢复
              </Checkbox>
              <span className="text-xs text-muted">告警解除时再发一条，带回落值和告警期间的峰值</span>
            </div>
            <div className="mt-4 grid grid-cols-[120px_1fr] items-center gap-x-4 gap-y-3 border-t border-line pt-4">
              <span className="text-sm text-ink">连续</span>
              <div className="flex items-center gap-3">
                <InputNumber
                  value={settings.alertSustain}
                  min={ALERT_SUSTAIN_RANGE.min}
                  max={ALERT_SUSTAIN_RANGE.max}
                  onCommit={(value) => updateSettings({ alertSustain: value })}
                  aria-label="连续几次采样达标才推送"
                  className="w-28"
                />
                <span className="text-xs text-muted">
                  次采样达标才推送，回落同理；每次 {POLL_SECONDS} 秒，现为{" "}
 秒
                </span>
              </div>
              <span className="text-sm text-ink">重复提醒</span>
              <div className="flex items-center gap-3">
                <InputNumber
                  value={settings.alertRepeatMinutes}
                  min={ALERT_REPEAT_RANGE.min}
                  max={ALERT_REPEAT_RANGE.max}
                  step={5}
                  onCommit={(value) => updateSettings({ alertRepeatMinutes: value })}
                  aria-label="告警未回落时每隔几分钟重复提醒"
                  className="w-28"
                />
                <span className="text-xs text-muted">分钟一次，告警未回落时再提醒；0 为不重复</span>
              </div>
              <span className="text-sm text-ink">负载取</span>
              <div className="flex items-center gap-3">
                <RadioGroup<LoadWindow>
                  value={settings.alertLoadWindow}
                  onChange={(value) => updateSettings({ alertLoadWindow: value })}
                  options={LOAD_WINDOW_OPTIONS}
                  aria-label="负载取哪个平均窗口"
                />
                <span className="text-xs text-muted">平均负载，按核数折算后判档</span>
              </div>
            </div>
          </section>

          <section>
            <h2 className="mb-1 text-sm font-semibold text-ink">正文带上</h2>
            <p className="mb-3 text-xs text-muted">
              主机名、指标、服务写进标题；当前值、阈值写进正文。勾选后下方预览立即更新。
            </p>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {FIELD_ORDER.map((field) => (
                <Checkbox
                  key={field}
                  checked={settings.notifyContentFields.includes(field)}
                  onChange={(checked) => toggleField(field, checked)}
                >
                  {FIELD_LABEL[field]}
                </Checkbox>
              ))}
            </div>
          </section>
        </div>

        <section aria-label="消息预览">
          <h2 className="mb-1 text-sm font-semibold text-ink">预览</h2>
          <p className="mb-3 text-xs text-muted">
            按当前设置，每类消息在各渠道收到的样子；示例主机 {sampleHost}，读数为示例值。
          </p>
          <PreviewMatrix
            rows={previewRows}
            channels={{
              system: settings.systemNotifyEnabled,
              inApp: settings.inAppNotifyEnabled,
              wecom: settings.notifyEnabled,
              wecomMissingWebhook: !savedExpanded,
            }}
          />
        </section>
      </div>
    </Page>
  );
}

function ResourceRuleRow({
  kind,
  loadWindow,
  levels,
  disabled,
  onChange,
}: {
  kind: ResourceAlertKind;
  loadWindow: LoadWindow;
  levels: AlertStartLevel[];
  disabled: boolean;
  onChange: (levels: AlertStartLevel[]) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-4">
      <span className="min-w-0 flex-1 text-xs text-muted">
        {alertRuleText(kind, levels, loadWindow)}
      </span>
      <div role="group" aria-label="订阅哪些档位" className="flex shrink-0 items-center gap-4">
        {LEVEL_ORDER.map((level) => {
          const checked = levels.includes(level);
          // 至少保留一档；整类不要了用左侧的类型勾选
          const last = checked && levels.length === 1;
          return (
            <Checkbox
              key={level}
              checked={checked}
              disabled={disabled || last}
              data-tip={last && !disabled ? "至少订阅一档，不需要这类通知请取消左侧勾选" : undefined}
              onChange={(next) =>
                onChange(LEVEL_ORDER.filter((item) => (item === level ? next : levels.includes(item))))
              }
            >
              {LEVEL_LABEL[level]} ≥ {levelPercent(level)}%
            </Checkbox>
          );
        })}
      </div>
    </div>
  );
}
