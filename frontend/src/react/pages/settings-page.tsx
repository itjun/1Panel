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
  const [boardEnabled, setBoardEnabled] = useState(true);
  const [boardPort, setBoardPort] = useState(8888);
  const egress = useQuery({
    queryKey: ["egress"],
    queryFn: () => api.getMyEgress(),
  });
  const status = useQuery({
    queryKey: ["panel-config-status"],
    queryFn: () => api.getPanelConfigStatus(),
  });
  const boardUrls = useQuery({
    queryKey: ["board-http-urls", boardEnabled, boardPort],
    queryFn: () => api.listBoardURLs(""),
    enabled: boardEnabled,
    retry: false,
  });

  useQuery({
    queryKey: ["ask-before-quit"],
    queryFn: async () => {
      const value = await api.getAskBeforeQuit();
      setAsk(value);
      return value;
    },
  });

  useQuery({
    queryKey: ["board-http-config"],
    queryFn: async () => {
      const cfg = await api.getBoardHTTPConfig();
      setBoardEnabled(!!cfg.enabled);
      setBoardPort(cfg.port > 0 ? cfg.port : 8888);
      return cfg;
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
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-7 px-6 py-5">
        {message ? <Notice text={message} /> : null}
        <section className="gap-card flex flex-col">
          <h2 className="text-xs font-semibold tracking-wide text-muted">外观</h2>
          <SettingRow label="界面字体" hint="改完立刻生效">
            <select
              className="h-8 rounded-control border border-line bg-surface px-2 text-sm"
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
        <section className="gap-card flex flex-col">
          <h2 className="text-xs font-semibold tracking-wide text-muted">会话</h2>
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
        <section className="gap-card flex flex-col">
          <h2 className="text-xs font-semibold tracking-wide text-muted">看板 HTTP</h2>
          <SettingRow
            label="内网看板"
            hint="仅私网 IPv4 可访问；浏览器打开 http://内网IP:端口/分组名"
          >
            <label className="mr-3 inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={boardEnabled}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  setBoardEnabled(enabled);
                  void api
                    .setBoardHTTPConfig({ enabled, port: boardPort })
                    .then(() => setMessage(enabled ? "看板 HTTP 已开启" : "看板 HTTP 已关闭"))
                    .catch((error) => setMessage(formatErr(error)));
                }}
              />
              开启
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              端口
              <input
                type="number"
                min={1}
                max={65535}
                className="h-8 w-24 rounded-control border border-line bg-surface px-2 text-sm"
                value={boardPort}
                onChange={(event) => setBoardPort(Number(event.target.value) || 8888)}
                onBlur={() => {
                  const port = boardPort > 0 && boardPort <= 65535 ? boardPort : 8888;
                  setBoardPort(port);
                  void api
                    .setBoardHTTPConfig({ enabled: boardEnabled, port })
                    .then(() => {
                      setMessage(`看板端口已设为 ${port}`);
                      void boardUrls.refetch();
                    })
                    .catch((error) => setMessage(formatErr(error)));
                }}
              />
            </label>
          </SettingRow>
          <SettingRow label="示例链接" hint="本机私网地址">
            <div className="flex flex-col gap-1 text-sm">
              {(boardUrls.data || []).length ? (
                (boardUrls.data || []).map((url) => (
                  <code key={url} className="break-all text-xs text-muted">
                    {url}
                  </code>
                ))
              ) : (
                <span className="text-muted">
                  {boardEnabled ? "暂无私网 IP，可用 127.0.0.1" : "未开启"}
                </span>
              )}
            </div>
            <Button
              disabled={!boardEnabled}
              onClick={() => void boardUrls.refetch()}
            >
              刷新
            </Button>
          </SettingRow>
        </section>
        <section className="gap-card flex flex-col">
          <h2 className="text-xs font-semibold tracking-wide text-muted">应用</h2>
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
    <div className="surface-float flex flex-wrap items-center justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <div className="text-sm font-medium text-ink">{label}</div>
        {hint ? <div className="mt-0.5 text-xs text-muted">{hint}</div> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
