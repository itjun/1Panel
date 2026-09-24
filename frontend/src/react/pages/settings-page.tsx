// INTEGRATION: entry 改为使用本文件的 SettingsPage。
import { Dialogs, Events } from "@wailsio/runtime";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { api } from "@/api";
import { Button } from "@/react/components/ui/button";
import { Notice, Page } from "@/react/components/page";
import {
  FONT_OPTIONS,
  SETTINGS_DEFAULTS,
  resetSettings,
  updateSettings,
  useSettings,
} from "@/react/state/settings";
import { useSession } from "@/react/state/session";
import { formatErr } from "@/utils/format";

export function SettingsPage() {
  const session = useSession();
  const settings = useSettings();
  const [ask, setAsk] = useState(true);
  const [message, setMessage] = useState("");
  const egress = useQuery({
    queryKey: ["egress"],
    queryFn: () => api.getMyEgress(),
  });
  const status = useQuery({
    queryKey: ["panel-config-status"],
    queryFn: () => api.getPanelConfigStatus(),
  });

  useQuery({
    queryKey: ["ask-before-quit"],
    queryFn: async () => {
      const value = await api.getAskBeforeQuit();
      setAsk(value);
      return value;
    },
  });

  const changed =
    settings.fontFamily !== SETTINGS_DEFAULTS.fontFamily ||
    settings.fontSize !== SETTINGS_DEFAULTS.fontSize ||
    settings.startupPage !== SETTINGS_DEFAULTS.startupPage ||
    !ask;

  return (
    <Page
      title="设置"
      actions={
        <Button
          disabled={!changed}
          onClick={() => {
            resetSettings();
            void api.setAskBeforeQuit(true).then(() => setAsk(true));
          }}
        >
          恢复默认值
        </Button>
      }
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        {message ? <Notice text={message} /> : null}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted">外观</h2>
          <SettingRow label="界面字体" hint="改完立刻生效">
            <select
              className="h-8 rounded-control border border-line bg-surface px-2"
              value={settings.fontFamily}
              onChange={(event) => updateSettings({ fontFamily: event.target.value })}
            >
              {FONT_OPTIONS.map((font) => (
                <option key={font.label} value={font.value}>
                  {font.label}
                </option>
              ))}
            </select>
          </SettingRow>
          <SettingRow label="界面字号" hint={`${settings.fontSize} px`}>
            <input
              type="range"
              min={11}
              max={20}
              value={settings.fontSize}
              onChange={(event) => updateSettings({ fontSize: Number(event.target.value) })}
            />
          </SettingRow>
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted">会话</h2>
          <SettingRow label="启动时打开">
            <label className="mr-3">
              <input
                type="radio"
                checked={settings.startupPage === "home"}
                onChange={() => updateSettings({ startupPage: "home" })}
              />
              应用首页
            </label>
            <label>
              <input
                type="radio"
                checked={settings.startupPage === "resume"}
                onChange={() => updateSettings({ startupPage: "resume" })}
              />
              离开画面
            </label>
          </SettingRow>
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted">应用</h2>
          <SettingRow label="本机出口" hint="公网 IP，来自 myip.ipip.net">
            <span>{egress.data?.ip || (egress.isLoading ? "检测中…" : "未知")}</span>
            {egress.data?.location ? (
              <span className="text-muted">{egress.data.location}</span>
            ) : null}
            <Button onClick={() => void egress.refetch()}>刷新</Button>
          </SettingRow>
          <SettingRow label="主机配置">
            <Button
              onClick={() => {
                void Dialogs.OpenFile({
                  Title: "选择备份位置",
                  CanChooseDirectories: true,
                  CanChooseFiles: false,
                  CanCreateDirectories: true,
                }).then((dir) => {
                  if (!dir) return;
                  return api.exportBackup(dir);
                }).then((msg) => {
                  if (msg) setMessage(msg);
                }).catch((error) => setMessage(formatErr(error)));
              }}
            >
              导出…
            </Button>
            <Button onClick={() => void Events.Emit("app-restart")}>重启应用</Button>
            {/* 与 Vue SettingsView 一致：发 app-quit-for-real，由后端 core.quitForReal 处理 */}
            <Button onClick={() => void Events.Emit("app-quit-for-real")}>退出应用</Button>
          </SettingRow>
          <SettingRow label="SSH 配置同步">
            <span>{statusLabel(status.data)}</span>
            <Button onClick={() => session.setConfigSection("overview")}>打开配置中心</Button>
          </SettingRow>
          <SettingRow label="退出前询问">
            <input
              type="checkbox"
              checked={ask}
              onChange={(event) => {
                const next = event.target.checked;
                setAsk(next);
                void api.setAskBeforeQuit(next);
              }}
            />
          </SettingRow>
        </section>
      </div>
    </Page>
  );
}

function statusLabel(status?: {
  needsReview?: boolean;
  configStale?: boolean;
  drift?: boolean;
}) {
  if (!status) return "检测中";
  if (status.needsReview) return "需导入确认";
  if (status.configStale) return "配置过期";
  if (status.drift) return "检测到外部修改";
  return "已同步";
}

function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-surface border border-line bg-surface px-5 py-4">
      <div>
        <div className="font-medium">{label}</div>
        {hint ? <div className="text-sm text-muted">{hint}</div> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
