import { Copy } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "@/api";
import {
  PreviewMatrix,
  type PreviewRow,
} from "@/react/components/notify/channel-preview";
import { NotifyPageHeader } from "@/react/components/notify/page-header";
import { NotifyPreviewNavigation } from "@/react/components/notify/preview-navigation";
import { lastMessageSource } from "@/react/components/notify/view-state";
import { FlashNotices, Page } from "@/react/components/page";
import { Button } from "@/react/components/ui/button";
import { Checkbox } from "@/react/components/ui/checkbox";
import { Switch } from "@/react/components/ui/switch";
import { useFlashMessage } from "@/react/lib/use-flash-message";
import {
  CHANNEL_SECTIONS,
  PREVIEW_CATEGORIES,
  PREVIEW_STATES,
  type PreviewCategory,
  type PreviewState,
  type ChannelSection,
} from "@/react/state/notify-channels-navigation";
import { useSession } from "@/react/state/session";
import {
  updateSettings,
  useSettings,
  type AlertContentKind,
  type NotifyContentField,
} from "@/react/state/settings";
import {
  ALERT_KIND_LABEL,
  alertThresholdText,
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
import "@/react/styles/settings.css";

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
  },
  {
    key: "inAppNotifyEnabled",
    label: "应用内消息",
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
  const [previewState, setPreviewState] = useState<PreviewState>("down");
  const [previewCategory, setPreviewCategory] = useState<PreviewCategory>("cpu");
  const settings = useSettings();
  const session = useSession();
  const flash = useFlashMessage();
  const [webhookDraft, setWebhookDraft] = useState(settings.wecomWebhook);
  const [isSaving, setIsSaving] = useState(false);
  const isSavingRef = useRef(false);

  // 设置里地址被别处改过时，同步草稿
  useEffect(() => {
    setWebhookDraft(settings.wecomWebhook);
  }, [settings.wecomWebhook]);

  const draftExpanded = expandWecomWebhook(webhookDraft);
  const savedExpanded = expandWecomWebhook(settings.wecomWebhook);
  const webhookDirty = draftExpanded !== savedExpanded;

  async function testAndSave() {
    if (isSavingRef.current || !settings.notifyEnabled) return;
    if (!draftExpanded) {
      if (!webhookDirty) return;
      updateSettings({ wecomWebhook: "" });
      flash.showToast("已清除通知回调");
      return;
    }
    isSavingRef.current = true;
    setIsSaving(true);
    try {
      await api.testWecomWebhook(draftExpanded);
      if (webhookDirty) {
        updateSettings({ wecomWebhook: draftExpanded });
        setWebhookDraft(draftExpanded);
        flash.showToast("测试消息已发到群里，地址已保存");
      } else {
        flash.showToast("测试消息已发到群里");
      }
    } catch (error) {
      flash.showError(
        webhookDirty
          ? `测试失败，地址没有保存：${formatErr(error)}`
          : `测试失败：${formatErr(error)}`,
      );
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
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
    for (const option of PREVIEW_CATEGORIES) {
      const contentKind: AlertContentKind =
        option.id === "app" ? "app" : option.id;
      const kindOff = !settings.alertContentKinds.includes(contentKind);
      for (const { id: state } of PREVIEW_STATES) {
        const up = state === "up";
        let muted = "";
        if (kindOff) muted = "未勾选，不会发送";
        else if (up && !settings.notifyRecoverEnabled) muted = "「恢复」未勾选";
        if (option.id === "app") {
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
        const kind = option.id;
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

  const previewChannels = {
    system: settings.systemNotifyEnabled,
    inApp: settings.inAppNotifyEnabled,
    wecom: settings.notifyEnabled,
    wecomMissingWebhook: !savedExpanded,
  };
  const selectedRows = previewRows.filter((row) => row.state === previewState && (previewCategory === "app" ? row.kind.startsWith("app:") : row.kind === previewCategory));
  return (
    <Page heading={false} flush scrollLabel="发送渠道内容">
      <FlashNotices flash={flash} />
      <div className="settings-document notify-channel-document">
        <NotifyPageHeader title="发送渠道" source={lastMessageSource()} />
        <ChannelSectionBlock id="channels">
          <div className="notify-channel-rows">
            {CHANNELS.map((channel) => (
              <div key={channel.key}>
                <div className="notify-channel-row">
                  <strong>{channel.label}</strong>
                  <Switch
                    checked={settings[channel.key]}
                    onChange={(checked) => updateSettings({ [channel.key]: checked })}
                    aria-label={channel.label}
                  >
                    {channel.label}
                  </Switch>
                </div>
              </div>
            ))}
          </div>
        </ChannelSectionBlock>
        <ChannelSectionBlock id="wecom">
          <div className="notify-callback-provider">
            <div className="notify-channel-row">
              <strong>企业微信</strong>
              <Switch
                checked={settings.notifyEnabled}
                onChange={(notifyEnabled) => updateSettings({ notifyEnabled })}
                aria-label="企业微信"
              >企业微信</Switch>
            </div>
            <div className="flex min-w-0 flex-wrap gap-2">
              <div className="relative min-w-0 flex-1">
                <input
                  id="notify-callback-url"
                  className="motion-field h-8 w-full rounded-control pr-9 pl-3 disabled:opacity-50"
                  value={webhookDraft}
                  disabled={!settings.notifyEnabled || isSaving}
                  placeholder="粘贴完整 Webhook 地址，或只填 key"
                  aria-label="通知回调"
                  onChange={(event) => setWebhookDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !isSaving &&
                      (draftExpanded || webhookDirty)
                    )
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
                  !settings.notifyEnabled ||
                  isSaving ||
                  (!draftExpanded && !webhookDirty)
                }
                onClick={() => void testAndSave()}
              >
                {isSaving
                  ? "测试中…"
                  : !draftExpanded
                    ? "清除地址"
                    : webhookDirty
                      ? "测试并保存"
                      : "测试消息"}
              </Button>
            </div>
          </div>
        </ChannelSectionBlock>
        <ChannelSectionBlock id="recovery">
          <div>
            <Switch
              checked={settings.notifyRecoverEnabled}
              onChange={(notifyRecoverEnabled) =>
                updateSettings({ notifyRecoverEnabled })
              }
            >
              恢复时通知
            </Switch>
          </div>
        </ChannelSectionBlock>
        <ChannelSectionBlock id="content">
          <div className="flex flex-wrap gap-x-5 gap-y-3">
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
        </ChannelSectionBlock>
        <ChannelSectionBlock id="preview">
          <NotifyPreviewNavigation
            state={previewState}
            category={previewCategory}
            onStateChange={setPreviewState}
            onCategoryChange={setPreviewCategory}
          />
          <PreviewMatrix rows={selectedRows} channels={previewChannels} />
        </ChannelSectionBlock>
      </div>
    </Page>
  );
}

function ChannelSectionBlock({ id, children }: { id: ChannelSection; children: ReactNode }) {
  const section = CHANNEL_SECTIONS.find((item) => item.id === id)!;
  return (
    <section
      id={`notify-channel-${id}`}
      aria-labelledby={`notify-channel-${id}-title`}
      className="notify-channel-panel"
    >
      <h2 id={`notify-channel-${id}-title`}>{section.label}</h2>
      {children}
    </section>
  );
}
