import { Copy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/api";
import {
  PreviewMatrix,
  type PreviewRow,
} from "@/react/components/notify/channel-preview";
import { NotifyPageHeader } from "@/react/components/notify/page-header";
import { lastMessageSource } from "@/react/components/notify/view-state";
import { Select } from "@/react/components/ui/select";
import { FlashNotices, Page } from "@/react/components/page";
import { Button } from "@/react/components/ui/button";
import { Checkbox } from "@/react/components/ui/checkbox";
import { RadioGroup } from "@/react/components/ui/radio-group";
import { Switch } from "@/react/components/ui/switch";
import { useFlashMessage } from "@/react/lib/use-flash-message";
import { useSession } from "@/react/state/session";
import {
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
  LEVEL_LABEL,
  levelPercent,
  normalizeAlertLevels,
  type AlertCondition,
  type AlertStartLevel,
  type LoadWindow,
  type ResourceAlertKind,
} from "@/utils/alerts";
import { copyText } from "@/utils/clipboard";
import { formatErr } from "@/utils/format";
import {
  buildNotifyMessage,
  type NotifyTextParts,
} from "@/utils/notifyMessage";

const WECOM_WEBHOOK_PREFIX =
  "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=";

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
    label: "桌面通知",
    desc: "弹出系统通知横幅，点开直接定位到这条消息",
  },
  {
    key: "inAppNotifyEnabled",
    label: "应用内消息",
    desc: "记录到通知中心并显示未读数",
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
  value: "记录值",
  service: "服务",
};

const FIELD_ORDER: NotifyContentField[] = [
  "hostName",
  "metric",
  "service",
  "value",
  "threshold",
];

type SampleKind = ResourceAlertKind | "app";

const SAMPLE_OPTIONS: { value: SampleKind; label: string }[] = [
  ...ALERT_RULES.map((rule) => ({
    value: rule.kind as SampleKind,
    label: rule.name,
  })),
  { value: "app", label: "应用探活" },
];

type SampleReading = { text: string; condition?: AlertCondition };

/** 预览用的示例读数：警告档读数、危险档读数（也当峰值）、回落值 */
function sampleReadings(
  kind: ResourceAlertKind,
  loadWindow: LoadWindow,
): { warn: SampleReading; danger: SampleReading; recovered: SampleReading } {
  switch (kind) {
    case "cpu":
      return {
        warn: { text: "64.2%" },
        danger: { text: "91.3%" },
        recovered: { text: "42.1%" },
      };
    case "mem":
      return {
        warn: { text: "67.5%" },
        danger: { text: "88.2%" },
        recovered: { text: "52.4%" },
      };
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
  const [sampleKind, setSampleKind] = useState<SampleKind>("mem");
  const [sampleState, setSampleState] = useState<"down" | "up">("down");

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
      const contentKind: AlertContentKind =
        option.value === "app" ? "app" : option.value;
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
            message: buildNotifyMessage({
              state,
              kind: "app",
              parts,
              fields: settings.notifyContentFields,
            }),
          });
          continue;
        }
        const kind = option.value;
        const levels = normalizeAlertLevels(settings.alertLevels[kind]);
        const start = levels[0];
        const sample = sampleReadings(kind, settings.alertLoadWindow);
        const base = {
          name: option.label,
          host: sampleHost,
          kind,
          state,
          muted,
        };
        const fields = settings.notifyContentFields;
        const partsFor = (
          level: AlertStartLevel,
          reading: SampleReading,
          peak?: SampleReading,
        ): NotifyTextParts => ({
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

  function toggleField(field: NotifyContentField, checked: boolean) {
    const next = checked
      ? [...settings.notifyContentFields, field]
      : settings.notifyContentFields.filter((item) => item !== field);
    updateSettings({ notifyContentFields: next });
  }

  const selectedPreview = previewRows.find(
    (row) =>
      (sampleKind === "app"
        ? row.kind.startsWith("app:")
        : row.kind === sampleKind) && row.state === sampleState,
  );
  return (
    <Page heading={false} flush>
      <FlashNotices flash={flash} />
      <div className="notify-workspace">
        <NotifyPageHeader
          title="发送渠道"
          description="所有消息来源共用，订阅与规则在各自分类中管理"
          source={lastMessageSource()}
        />
        <div className="notify-settings-body">
          <div className="notify-channel-layout">
            <div className="notify-channel-settings">
              <section>
                <h2>接收渠道</h2>
                <div className="notify-channel-rows">
                  {CHANNELS.map((channel) => (
                    <div key={channel.key}>
                      <div>
                        <strong>{channel.label}</strong>
                        <p>{channel.desc}</p>
                      </div>
                      <Switch
                        checked={settings[channel.key]}
                        onChange={(checked) =>
                          updateSettings({ [channel.key]: checked })
                        }
                        aria-label={channel.label}
                      >
                        {channel.label}
                      </Switch>
                    </div>
                  ))}
                </div>
                <p className="notify-description">开关更改自动保存。</p>
              </section>
              <section className="notify-separated">
                <h2>企业微信地址</h2>
                <div className="mt-3 flex min-w-0 flex-wrap gap-2">
                  <div className="relative min-w-0 flex-1">
                    <input
                      className="motion-field h-8 w-full rounded-control pr-9 pl-3 disabled:opacity-50"
                      value={webhookDraft}
                      disabled={!settings.notifyEnabled}
                      placeholder="粘贴完整 Webhook 地址，或只填 key"
                      aria-label="企业微信 Webhook 地址"
                      onChange={(event) => setWebhookDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && webhookDirty && !saving)
                          void testAndSave();
                      }}
                    />
                    <button
                      type="button"
                      aria-label="复制完整地址"
                      disabled={!settings.notifyEnabled || !draftExpanded}
                      className="absolute top-1 right-1 flex size-6 items-center justify-center text-muted disabled:opacity-50"
                      onClick={() => {
                        void copyText(draftExpanded)
                          .then(() => flash.showToast("已复制完整地址"))
                          .catch(() => flash.showError("复制失败"));
                      }}
                    >
                      <Copy size={16} strokeWidth={1.5} aria-hidden />
                    </button>
                  </div>
                  <Button
                    variant="primary"
                    disabled={
                      !settings.notifyEnabled || !webhookDirty || saving
                    }
                    onClick={() => void testAndSave()}
                  >
                    {draftExpanded || !savedExpanded
                      ? "测试并保存"
                      : "清除地址"}
                  </Button>
                </div>
                <p className="notify-description">
                  {!settings.notifyEnabled
                    ? "开启企业微信后可填写。"
                    : webhookDirty
                      ? "地址尚未保存。"
                      : savedExpanded
                        ? "地址已保存。"
                        : "尚未填写地址，不会发送企业微信消息。"}
                </p>
                <p className="notify-description">
                  测试会向群内发送 1 条消息，成功后才保存地址。
                </p>
              </section>
              <section className="notify-separated">
                <h2>通用提醒</h2>
                <div className="mt-3">
                  <Switch
                    checked={settings.notifyRecoverEnabled}
                    onChange={(notifyRecoverEnabled) =>
                      updateSettings({ notifyRecoverEnabled })
                    }
                  >
                    恢复时通知
                  </Switch>
                </div>
                <p className="notify-description">
                  主机回落、应用恢复、证书续期共用此开关。
                </p>
              </section>
              <section className="notify-separated">
                <h2>消息内容</h2>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-3">
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
                <p className="notify-description">
                  字段更改同步更新预览，不会发送消息。
                </p>
              </section>
            </div>
            <details className="notify-channel-preview" open>
              <summary>
                消息预览 <span>示例，不会发送</span>
              </summary>
              <div className="notify-preview-controls">
                <Select
                  aria-label="选择预览指标或服务"
                  value={sampleKind}
                  onChange={setSampleKind}
                  options={SAMPLE_OPTIONS}
                  className="min-w-0 flex-1"
                />
                <RadioGroup
                  aria-label="预览消息状态"
                  value={sampleState}
                  onChange={setSampleState}
                  options={[
                    { value: "down", label: "告警" },
                    { value: "up", label: "恢复" },
                  ]}
                />
              </div>
              <PreviewMatrix
                rows={selectedPreview ? [selectedPreview] : []}
                stacked
                channels={{
                  system: settings.systemNotifyEnabled,
                  inApp: settings.inAppNotifyEnabled,
                  wecom: settings.notifyEnabled,
                  wecomMissingWebhook: !savedExpanded,
                }}
              />
              <details className="mt-6">
                <summary className="cursor-pointer text-sm text-muted">
                  查看全部消息示例
                </summary>
                <div className="mt-4 overflow-auto">
                  <PreviewMatrix
                    rows={previewRows}
                    channels={{
                      system: settings.systemNotifyEnabled,
                      inApp: settings.inAppNotifyEnabled,
                      wecom: settings.notifyEnabled,
                      wecomMissingWebhook: !savedExpanded,
                    }}
                  />
                </div>
              </details>
            </details>
          </div>
          <p className="notify-description mt-6">
            常规设置自动保存；Webhook 地址需测试后保存。
          </p>
        </div>
      </div>
    </Page>
  );
}
