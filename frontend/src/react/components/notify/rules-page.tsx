import { BellRing } from "lucide-react";
import { Page } from "@/react/components/page";
import { NotifyPageHeader } from "@/react/components/notify/page-header";
import { useNotifyView } from "@/react/components/notify/view-state";
import { Button } from "@/react/components/ui/button";
import { Checkbox } from "@/react/components/ui/checkbox";
import { InputNumber } from "@/react/components/ui/input-number";
import { RadioGroup } from "@/react/components/ui/radio-group";
import { Switch } from "@/react/components/ui/switch";
import { Tag } from "@/react/components/ui/tag";
import type { NotifySource } from "@/react/lib/notify-model";
import { useSession } from "@/react/state/session";
import {
  ALERT_REPEAT_RANGE,
  ALERT_SUSTAIN_RANGE,
  updateSettings,
  useSettings,
  type AlertContentKind,
} from "@/react/state/settings";
import {
  ALERT_RULES,
  DISK_AVAIL_GB,
  LEVEL_LABEL,
  LOAD_WINDOW_LABEL,
  RESOURCE_POLL_MS,
  alertThresholdText,
  levelPercent,
  normalizeAlertLevels,
  type AlertStartLevel,
  type LoadWindow,
  type ResourceAlertKind,
} from "@/utils/alerts";

const LEVELS: AlertStartLevel[] = ["warn", "danger"];
export function toggleNotifyKind(
  kind: AlertContentKind,
  enabled: boolean,
  current: AlertContentKind[],
) {
  updateSettings({
    alertContentKinds: enabled
      ? [...new Set([...current, kind])]
      : current.filter((value) => value !== kind),
  });
}

function threshold(kind: ResourceAlertKind, level: AlertStartLevel) {
  return kind === "disk"
    ? `≥ ${levelPercent(level)}% 或可用 ≤ ${DISK_AVAIL_GB[level]} GB`
    : alertThresholdText(kind, level).replace(`${LEVEL_LABEL[level]} `, "");
}

export function NotifyRulesPage({ source }: { source: NotifySource }) {
  const settings = useSettings();
  const session = useSession();
  const [view, setView] = useNotifyView(`rules-${source}`, { scrollTop: 0 });
  const label =
    source === "metric"
      ? "主机系统 · 告警规则"
      : source === "app"
        ? "应用服务 · 告警规则"
        : "证书提醒 · 提醒规则";
  return (
    <Page heading={false} flush>
      <div className="notify-workspace">
        <NotifyPageHeader
          title={label}
          source={source}
        />
        <div
          className="notify-settings-body"
          ref={(node) => {
            if (node && !node.dataset.restored) {
              node.scrollTop = view.scrollTop;
              node.dataset.restored = "true";
            }
          }}
          onScroll={(event) =>
            setView({ scrollTop: event.currentTarget.scrollTop })
          }
        >
          {source === "metric" ? (
            <>
              <section>
                <div className="notify-section-title">
                  <h2>告警规则</h2>
                  <Tag>全局</Tag>
                </div>
                <div className="notify-table-scroll">
                  <table className="notify-rules-table">
                    <thead>
                      <tr>
                        <th>指标</th>
                        <th>启用</th>
                        <th>警告档</th>
                        <th>危险档</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ALERT_RULES.map((rule) => {
                        const enabled = settings.alertContentKinds.includes(
                          rule.kind,
                        );
                        const levels = normalizeAlertLevels(
                          settings.alertLevels[rule.kind],
                        );
                        return (
                          <tr key={rule.kind}>
                            <td>
                              <strong>{rule.name}</strong>
                            </td>
                            <td>
                              <Checkbox
                                aria-label={`启用${rule.name}通知`}
                                checked={enabled}
                                onChange={(checked) =>
                                  toggleNotifyKind(
                                    rule.kind,
                                    checked,
                                    settings.alertContentKinds,
                                  )
                                }
                              />
                            </td>
                            {LEVELS.map((level) => (
                              <td key={level}>
                                <Checkbox
                                  aria-label={`${rule.name}${LEVEL_LABEL[level]}档`}
                                  checked={levels.includes(level)}
                                  disabled={
                                    !enabled ||
                                    (levels.includes(level) &&
                                      levels.length === 1)
                                  }
                                  data-tip={
                                    levels.includes(level) &&
                                    levels.length === 1
                                      ? "至少保留一档；可关闭该指标通知"
                                      : undefined
                                  }
                                  onChange={(checked) =>
                                    updateSettings({
                                      alertLevels: {
                                        ...settings.alertLevels,
                                        [rule.kind]: LEVELS.filter((item) =>
                                          item === level
                                            ? checked
                                            : levels.includes(item),
                                        ),
                                      },
                                    })
                                  }
                                >
                                  {threshold(rule.kind, level)}
                                </Checkbox>
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="notify-separated">
                <h2>触发与重复</h2>
                <div className="notify-rule-fields">
                  <span>连续采样</span>
                  <div>
                    <InputNumber
                      value={settings.alertSustain}
                      min={ALERT_SUSTAIN_RANGE.min}
                      max={ALERT_SUSTAIN_RANGE.max}
                      onCommit={(alertSustain) =>
                        updateSettings({ alertSustain })
                      }
                      aria-label="连续采样次数"
                      className="w-28"
                    />
                    <span>
                      次（每次 {RESOURCE_POLL_MS / 1000} 秒，共{" "}
                      {(settings.alertSustain * RESOURCE_POLL_MS) / 1000} 秒）
                    </span>
                  </div>
                  <span>重复提醒</span>
                  <div>
                    <InputNumber
                      value={settings.alertRepeatMinutes}
                      min={ALERT_REPEAT_RANGE.min}
                      max={ALERT_REPEAT_RANGE.max}
                      step={5}
                      onCommit={(alertRepeatMinutes) =>
                        updateSettings({ alertRepeatMinutes })
                      }
                      aria-label="重复提醒间隔"
                      className="w-28"
                    />
                    <span>分钟，0 为不重复</span>
                  </div>
                  <span>负载窗口</span>
                  <div>
                    <RadioGroup
                      aria-label="负载平均窗口"
                      value={settings.alertLoadWindow}
                      onChange={(alertLoadWindow: LoadWindow) =>
                        updateSettings({ alertLoadWindow })
                      }
                      options={(["load1", "load5", "load15"] as const).map(
                        (value) => ({ value, label: LOAD_WINDOW_LABEL[value] }),
                      )}
                    />
                  </div>
                </div>
              </section>
            </>
          ) : source === "app" ? (
            <>
              <section>
                <div className="notify-section-title">
                  <h2>应用探活通知</h2>
                  <Tag>全局</Tag>
                </div>
                <Switch
                  checked={settings.alertContentKinds.includes("app")}
                  onChange={(checked) =>
                    toggleNotifyKind("app", checked, settings.alertContentKinds)
                  }
                >
                  启用应用探活通知
                </Switch>
              </section>
              <section className="notify-separated">
                <h2>触发条件</h2>
                <ul className="notify-condition-list">
                  <li>进程检查失败</li>
                  <li>健康检查失败</li>
                  <li>入口检查失败</li>
                </ul>
              </section>
              <Button onClick={() => session.setNotifySection("appSubs")}>
                <BellRing size={16} strokeWidth={1.5} aria-hidden />
                管理应用订阅
              </Button>
            </>
          ) : (
            <>
              <section>
                <div className="notify-section-title">
                  <h2>证书到期提醒</h2>
                  <Tag>全局</Tag>
                </div>
                <Switch
                  checked={settings.alertContentKinds.includes("cert")}
                  onChange={(checked) =>
                    toggleNotifyKind(
                      "cert",
                      checked,
                      settings.alertContentKinds,
                    )
                  }
                >
                  启用证书到期提醒
                </Switch>
              </section>
              <section className="notify-separated">
                <h2>检测与提醒方式</h2>
                <dl className="notify-fixed-rules">
                  <dt>检测范围</dt>
                  <dd>主机端支持检测的 /etc/nginx/cert 证书</dd>
                  <dt>扫描频率</dt>
                  <dd>每天 06:00，以主机端扫描结果为准</dd>
                  <dt>到期提醒</dt>
                  <dd>剩余不足 30 天或已过期时，每天提醒一次</dd>
                  <dt>续期提醒</dt>
                  <dd>续期后按全局“恢复时通知”设置发送</dd>
                </dl>
              </section>
            </>
          )}
          <div className="notify-global-recovery notify-separated">
            <span>
              恢复通知：{settings.notifyRecoverEnabled ? "已开启" : "已关闭"}
            </span>
            <Button
              variant="ghost"
              onClick={() => session.setNotifySection("setup")}
            >
              前往发送渠道查看
            </Button>
          </div>
        </div>
      </div>
    </Page>
  );
}
