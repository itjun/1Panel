// INTEGRATION: entry 改为使用本文件的 SettingsPage。
import { Events } from "@wailsio/runtime";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/api";
import appIcon from "@/react/assets/appicon.png";
import {
  HostBackupRestoreDialog,
  exportHostBackup,
  pickHostBackupFile,
} from "@/react/components/backup/host-backup";
import { Button } from "@/react/components/ui/button";
import { InputNumber } from "@/react/components/ui/input-number";
import { RadioGroup } from "@/react/components/ui/radio-group";
import { Select } from "@/react/components/ui/select";
import { Slider } from "@/react/components/ui/slider";
import { Switch } from "@/react/components/ui/switch";
import { FlashNotices, Page } from "@/react/components/page";
import { FontListPanel } from "@/react/components/font-picker";
import {
  customFontName,
  fontOptions,
  isPresetFont,
  type FontKind,
} from "@/react/lib/fonts";
import { useFlashMessage } from "@/react/lib/use-flash-message";
import {
  SETTINGS_DEFAULTS,
  resetSettings,
  updateSettings,
  useSettings,
} from "@/react/state/settings";
import { useSession } from "@/react/state/session";
import { openUpdateDialog, setUpdateState, useAppUpdate } from "@/react/state/app-update";
import { formatErr } from "@/utils/format";
import { setWindowMaterial, useWindowTheme, type WindowMaterial } from "@/react/state/window-theme";

import { detectAppOs } from "@/react/lib/platform";
import { PLATFORM_SETTINGS, SETTINGS_SECTIONS, settingsShortcuts, showWindowMaterial } from "@/react/lib/settings-model";
import { useSettingsScroll } from "@/react/lib/use-settings-scroll";
import { AppearancePreviews } from "@/react/components/settings-appearance";
import type { SettingsSection } from "@/react/state/session";
import "@/react/styles/settings.css";

export function SettingsPage() {
  const session = useSession();
  const settings = useSettings();
  const os = detectAppOs();
  const platform = PLATFORM_SETTINGS[os];
  const documentRef = useRef<HTMLDivElement>(null);
  useSettingsScroll(documentRef, session.settingsSection);
  const windowTheme = useWindowTheme();
  const [ask, setAsk] = useState(true);
  const flash = useFlashMessage();
  const [boardEnabled, setBoardEnabled] = useState(true);
  const [boardPort, setBoardPort] = useState(8888);
  const [restorePath, setRestorePath] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const launchAtLogin = useQuery({
    queryKey: ["launch-at-login"],
    queryFn: () => api.getLaunchAtLoginState(),
    refetchOnWindowFocus: "always",
    retry: false,
  });
  const setLaunchAtLogin = useMutation({
    mutationFn: (enabled: boolean) => api.setLaunchAtLogin(enabled),
    onMutate: () => queryClient.cancelQueries({ queryKey: ["launch-at-login"] }),
    onSuccess: (state) => {
      queryClient.setQueryData(["launch-at-login"], state);
      if (state.reason) flash.showError(state.reason);
      else flash.showToast(state.enabled ? "已允许开机启动" : "已关闭开机启动");
    },
    onError: (error) => flash.showError(formatErr(error)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["launch-at-login"] }),
  });
  useEffect(() => {
    const refresh = () => { void queryClient.invalidateQueries({ queryKey: ["launch-at-login"] }); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [queryClient]);
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
    windowTheme.theme.preference !== "auto" ||
    settings.appearance !== SETTINGS_DEFAULTS.appearance ||
    settings.fontFamily !== SETTINGS_DEFAULTS.fontFamily ||
    settings.monoFontFamily !== SETTINGS_DEFAULTS.monoFontFamily ||
    settings.fontSize !== SETTINGS_DEFAULTS.fontSize ||
    settings.startupPage !== SETTINGS_DEFAULTS.startupPage ||
    (launchAtLogin.data?.supported && !launchAtLogin.data.enabled) ||
    !ask;

  const materialVisible = showWindowMaterial(os, windowTheme.desktop, windowTheme.theme.supported);
  const resetButton = (
          <Button
            size="sm"
            disabled={!changed || windowTheme.pending || setLaunchAtLogin.isPending}
            onClick={() => {
              void (async () => {
                try {
                  if (windowTheme.desktop) await setWindowMaterial("auto");
                  resetSettings();
                  await api.setAskBeforeQuit(true);
                  setAsk(true);
                  if (launchAtLogin.data?.supported && !launchAtLogin.data.enabled) {
                    await setLaunchAtLogin.mutateAsync(true);
                  }
                } catch (error) { flash.showError(formatErr(error)); }
              })();
            }}
          >
            恢复默认值
          </Button>
  );

  return (
    <Page title="设置" heading={false} flush scrollLabel="设置内容">
      <div ref={documentRef} className="settings-document">
        <header className="settings-header">
          <div className="flex flex-wrap items-baseline gap-3">
            <h1>设置</h1>
            <span className="text-xs text-muted">当前设备：{platform.name}</span>
          </div>
          <span className="text-xs text-muted">更改即时生效</span>
        </header>
        <FlashNotices flash={flash} />
        <HostBackupRestoreDialog
          path={restorePath}
          onClose={() => setRestorePath(null)}
          onRestored={(message) => flash.showToast(message)}
          onError={(message) => flash.showError(message)}
        />

        <SettingsSectionBlock id="look" actions={resetButton}>
            {materialVisible ? <SettingRow label="窗口材质" hint="按本机能力选择，立即生效">
              <div className="flex flex-col items-start gap-2">
                <RadioGroup<WindowMaterial>
                  aria-label="窗口材质"
                  value={windowTheme.theme.preference as WindowMaterial}
                  disabled={windowTheme.pending || !windowTheme.desktop}
                  onChange={(preference) => {
                    void setWindowMaterial(preference).catch((error) => flash.showError(formatErr(error)));
                  }}
                  options={[
                    { value: "auto", label: "自动" },
                    { value: "classic", label: "经典" },
                    { value: "mica", label: "云母" },
                  ]}
                />
                <p className="m-0 text-xs text-muted" role="status">
                  当前生效：{windowTheme.theme.effective === "mica" ? "云母" : "经典"}
                  {windowTheme.theme.reason ? ` · ${windowTheme.theme.reason}` : ""}
                </p>
                <p className="m-0 text-xs text-muted">云母在 Windows 11 上随壁纸轻微着色并指示窗口焦点。材质用于顶部和侧栏，内容区保持实色。</p>
              </div>
            </SettingRow> : null}
            <SettingRow label="主题外观">
              <AppearancePreviews os={os} value={settings.appearance} onChange={(appearance) => updateSettings({ appearance })} />
            </SettingRow>
            <FontSettingRow
              label="界面字体"
              hint={`界面文字 · ${platform.sans}，选择仅保存在本机`}
              kind="sans"
              value={settings.fontFamily}
              onChange={(value) => updateSettings({ fontFamily: value })}
            />
            <FontSettingRow
              label="等宽字体"
              hint={`IP、路径、日志与配置编辑器 · ${platform.mono}`}
              kind="mono"
              value={settings.monoFontFamily}
              onChange={(value) => updateSettings({ monoFontFamily: value })}
            />
            <SettingRow
              label="界面字号"
              hint={`${settings.fontSize} px · 界面上的所有文字；配置编辑器固定 14px`}
            >
              <Slider
                aria-label="界面字号"
                min={11}
                max={20}
                value={settings.fontSize}
                formatTip={(size) => `${size} px`}
                onChange={(fontSize) => updateSettings({ fontSize })}
              />
            </SettingRow>
            <SettingRow label="字体预览"><div className="settings-font-preview"><SansFontPreview /><MonoFontPreview /></div></SettingRow>
        </SettingsSectionBlock>

        <SettingsSectionBlock id="session">
            <SettingRow label="启动时打开">
              <RadioGroup
                aria-label="启动时打开"
                value={settings.startupPage}
                onChange={(startupPage) => updateSettings({ startupPage })}
                options={[
                  { value: "home", label: "应用首页" },
                  { value: "resume", label: "离开画面" },
                ]}
              />
            </SettingRow>
        </SettingsSectionBlock>

        <SettingsSectionBlock id="board">
            <SettingRow
              label="内网看板"
              hint="仅私网 IPv4 可访问；浏览器打开 http://内网IP:端口/分组名"
            >
              <Switch
                className="mr-3"
                aria-label="内网看板"
                checked={boardEnabled}
                onChange={(enabled) => {
                  setBoardEnabled(enabled);
                  void api
                    .setBoardHTTPConfig({ enabled, port: boardPort })
                    .then(() => flash.showToast(enabled ? "看板已开启" : "看板已关闭"))
                    .catch((error) => flash.showError(formatErr(error)));
                }}
              />
              <label className="inline-flex items-center gap-2 text-sm">
                端口
                <InputNumber
                  aria-label="看板端口"
                  min={1}
                  max={65535}
                  value={boardPort}
                  onCommit={(port) => {
                    if (port === boardPort) return;
                    setBoardPort(port);
                    void api
                      .setBoardHTTPConfig({ enabled: boardEnabled, port })
                      .then(() => {
                        flash.showToast(`看板端口已设为 ${port}`);
                        void boardUrls.refetch();
                      })
                      .catch((error) => flash.showError(formatErr(error)));
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
              <Button disabled={!boardEnabled} onClick={() => void boardUrls.refetch()}>
                刷新
              </Button>
            </SettingRow>
        </SettingsSectionBlock>

        <SettingsSectionBlock id="app">
            <SettingRow
              label="开机启动"
              hint={launchAtLogin.error ? formatErr(launchAtLogin.error) : launchAtLogin.data?.reason || "默认开启，登录系统后自动启动 1Panel"}
            >
              <Switch
                aria-label="允许应用开机启动"
                checked={launchAtLogin.data?.enabled ?? true}
                disabled={!launchAtLogin.data?.supported || launchAtLogin.isError}
                loading={launchAtLogin.isPending || setLaunchAtLogin.isPending}
                onChange={(enabled) => setLaunchAtLogin.mutate(enabled)}
              />
              {launchAtLogin.isError || (launchAtLogin.data?.supported && launchAtLogin.data.reason) ? (
                <Button size="sm" disabled={launchAtLogin.isFetching || setLaunchAtLogin.isPending} onClick={() => void launchAtLogin.refetch()}>
                  刷新状态
                </Button>
              ) : null}
            </SettingRow>
            <SettingRow label="本机出口" hint="公网 IP，来自 myip.ipip.net">
              <span>{egress.data?.ip || (egress.isLoading ? "检测中…" : "未知")}</span>
              {egress.data?.location ? (
                <span className="text-muted">{egress.data.location}</span>
              ) : null}
              <Button onClick={() => void egress.refetch()}>刷新</Button>
            </SettingRow>
            <SettingRow
              label="主机配置"
              hint="打包为 .zip（明文含密码与私钥），可在 macOS / Windows / Linux 间迁移"
            >
              <Button
                onClick={() => {
                  void exportHostBackup()
                    .then((msg) => {
                      if (msg) flash.showToast(msg);
                    })
                    .catch((error) => flash.showError(formatErr(error)));
                }}
              >
                导出…
              </Button>
              <Button
                onClick={() => {
                  void pickHostBackupFile()
                    .then((path) => {
                      if (path) setRestorePath(path);
                    })
                    .catch((error) => flash.showError(formatErr(error)));
                }}
              >
                导入…
              </Button>
            </SettingRow>
            <SettingRow label="运行">
              <Button onClick={() => void Events.Emit("app-restart")}>重启应用</Button>
              {/* 与 Vue SettingsView 一致：发 app-quit-for-real，由后端 core.quitForReal 处理 */}
              <Button onClick={() => void Events.Emit("app-quit-for-real")}>退出应用</Button>
            </SettingRow>
            <SettingRow label="SSH 配置同步">
              <span>{statusLabel(status.data)}</span>
              <Button onClick={() => session.setConfigSection("overview")}>打开配置中心</Button>
            </SettingRow>
            <TerminalOpenSettings />
            <SettingRow label="退出前询问">
              <Switch
                aria-label="退出前询问"
                checked={ask}
                onChange={(next) => {
                  setAsk(next);
                  void api.setAskBeforeQuit(next);
                }}
              />
            </SettingRow>
        </SettingsSectionBlock>

        <SettingsSectionBlock id="shortcuts">
            <div className="overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="h-table-head border-b border-line text-xs text-muted">
                    <th className="px-3 font-normal">功能</th>
                    <th className="px-3 font-normal">{platform.name} 快捷键</th>
                  </tr>
                </thead>
                <tbody>
                  {settingsShortcuts(os).map((row) => (
                    <tr key={row.label} className="h-table-row border-b border-line last:border-b-0">
                      <td className="px-3 text-ink">{row.label}</td>
                      <td className="px-3">
                        <ShortcutKeys keys={row.keys} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        </SettingsSectionBlock>

        <SettingsSectionBlock id="about"><AboutSection /></SettingsSectionBlock>
      </div>
    </Page>
  );
}

function SettingsSectionBlock({ id, actions, children }: { id: SettingsSection; actions?: ReactNode; children: ReactNode }) {
  const section = SETTINGS_SECTIONS.find((item) => item.id === id)!;
  return <section id={`settings-${id}`} data-settings-section={id} aria-labelledby={`settings-${id}-title`} className="settings-section">
    <header className="settings-section-heading">
      <h2 id={`settings-${id}-title`}>{section.label}</h2>
      <p>{section.hint}</p>
      {actions ? <div className="settings-section-actions">{actions}</div> : null}
    </header>
    <div className="settings-section-body">{children}</div>
  </section>;
}

/** 「关于」分区：应用名、版本与提交、运行环境、内置 Agent 与仓库链接。 */
function AboutSection() {
  const query = useQuery({
    queryKey: ["app-info"],
    queryFn: () => api.getAppInfo(),
    staleTime: 5 * 60 * 1000,
  });
  const info = query.data;
  const row = (label: string, value?: string) => (
    <SettingRow label={label}>
      <span className="font-mono text-sm text-ink">{value || (query.isLoading ? "…" : "—")}</span>
    </SettingRow>
  );
  return (
    <section className="flex flex-col">
      <SettingRow label="应用" hint={info?.description}>
        <img
          src={appIcon}
          alt="1Panel"
          className="rounded-control"
          width={40}
          height={40}
        />
        <span className="text-sm font-semibold text-ink">{info?.appName || "1Panel"}</span>
      </SettingRow>
      {row("版权", info?.copyright)}
      {row("版本", info?.version)}
      {row("构建提交", info?.commit ? `${info.commit}${info.commitTime ? ` · ${info.commitTime}` : ""}` : undefined)}
      {row("运行环境", info ? `${info.os} / ${info.arch}` : undefined)}
      {row("编译工具链", info?.goVersion)}
      {row("内置 Agent", info?.agentVer ? `v${info.agentVer}` : undefined)}
      <UpdateSettingRows />
      <SettingRow label="链接" hint="用系统浏览器打开">
        <Button size="sm" onClick={() => void api.openExternalURL(info?.repoUrl || "")}>
          源码仓库
        </Button>
        <Button size="sm" onClick={() => void api.openExternalURL(info?.releasesUrl || "")}>
          发布页
        </Button>
        <Button size="sm" onClick={() => void api.openExternalURL(info?.issuesUrl || "")}>
          问题反馈
        </Button>
      </SettingRow>
    </section>
  );
}

/** 「关于」里的应用更新：手动检查、状态说明与自动检查开关。 */
function UpdateSettingRows() {
  const { state } = useAppUpdate();
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState("");

  async function check() {
    setChecking(true);
    setCheckError("");
    try {
      const next = await api.checkUpdate();
      setUpdateState(next);
      if (next.hasUpdate) openUpdateDialog();
    } catch (e) {
      setCheckError(formatErr(e));
    } finally {
      setChecking(false);
    }
  }

  let hint = "…";
  if (state) {
    if (!state.enabled) hint = state.disabledReason || "此构建不支持自动更新";
    else if (checkError) hint = `检查失败：${checkError}`;
    else if (state.status === "downloading") hint = "正在下载新版本…";
    else if (state.status === "installing") hint = "正在安装，完成后自动重启…";
    else if (state.status === "error") hint = `更新失败：${state.error}`;
    else if (state.hasUpdate)
      hint = `发现新版本 ${state.latest}${state.mandatory ? "（必须更新）" : ""}`;
    else if (state.checkFailed) hint = `检查失败：${state.error || "连不上更新源"}`;
    else if (state.lastChecked) hint = `已是最新版本 · 上次检查 ${formatCheckTime(state.lastChecked)}`;
    else hint = "尚未检查";
  }
  const checkFailed = !!state?.enabled && (!!checkError || !!state?.checkFailed);

  return (
    <>
      <SettingRow label="应用更新" hint={hint}>
        {state?.hasUpdate ? (
          <Button size="sm" variant="primary" onClick={openUpdateDialog}>
            查看 {state.latest}
          </Button>
        ) : null}
        {checkFailed && state?.releaseUrl ? (
          <Button size="sm" onClick={() => void api.openExternalURL(state.releaseUrl)}>
            打开发布页
          </Button>
        ) : null}
        <Button
          size="sm"
          disabled={!state?.enabled || checking || state.status === "checking"}
          onClick={() => void check()}
        >
          {checking ? "检查中…" : "检查更新"}
        </Button>
      </SettingRow>
      <SettingRow label="自动检查更新" hint="启动时及每 6 小时检查一次；强制更新不受此开关影响">
        <Switch
          checked={state?.autoCheck ?? true}
          disabled={!state?.enabled}
          onChange={(on) => void api.setUpdateAutoCheck(on)}
          aria-label="自动检查更新"
        />
      </SettingRow>
    </>
  );
}

function formatCheckTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

function TerminalOpenSettings() {
  const settings = useSettings();
  const terminals = useQuery({
    queryKey: ["terminal-apps"],
    queryFn: () => api.listTerminalApps(),
  });
  const apps = terminals.data ?? [];
  const effective =
    apps.length === 1
      ? apps[0]
      : (apps.find((app) => app.id === settings.terminalApp) ??
        apps.find((app) => app.default) ??
        apps[0]);
  const showPicker = apps.length > 1;
  const showMode = effective?.supportsWindow === true;

  return (
    <>
      {showPicker && effective ? (
        <SettingRow label="终端" hint="「终端打开」主机时使用这个终端。只列出本机可用的。">
          <RadioGroup
            aria-label="终端"
            value={effective.id}
            onChange={(terminalApp) => updateSettings({ terminalApp })}
            options={apps.map((app) => ({ value: app.id, label: app.name }))}
          />
        </SettingRow>
      ) : null}
      {showMode ? (
        <SettingRow
          label={showPicker ? "打开方式" : "终端打开方式"}
          hint="在已有窗口新建标签页，或另开一个窗口"
        >
          <RadioGroup
            aria-label="终端打开方式"
            value={settings.terminalOpenMode}
            onChange={(mode) => updateSettings({ terminalOpenMode: mode })}
            options={[
              { value: "tab", label: "最近窗口新标签页" },
              { value: "window", label: "新窗口" },
            ]}
          />
        </SettingRow>
      ) : null}
    </>
  );
}

function SettingRow({
  label,
  hint,
  children,
  below,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  /** 整行下方的预览 / 补充内容，独占一行 */
  below?: ReactNode;
}) {
  return (
    <div className="settings-row min-h-14 border-b border-line py-4 last:border-b-0">
      <div className="settings-row-label text-sm text-ink">{label}</div>
      <div className="settings-row-controls flex min-w-0 flex-wrap items-center gap-2">
        {children}
        {hint ? <span className="settings-row-hint text-xs text-muted">{hint}</span> : null}
      </div>
      {below ? <div className="settings-row-below">{below}</div> : null}
    </div>
  );
}

/** 下拉里「自定义…」这一项的占位值；真正存的是本机字体名 + 系统后备栈 */
const CUSTOM_FONT_OPTION = "__custom__";

/**
 * 一行字体设置：按当前系统列出预设，最后一项「自定义…」在行下方展开本机字体列表，点一项即生效。
 * 存储值不在当前系统的预设里（比如换了电脑）时，也显示为自定义。
 */
function FontSettingRow({
  label,
  hint,
  kind,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  kind: FontKind;
  value: string;
  onChange: (value: string) => void;
}) {
  const options = fontOptions(kind);
  const [customMode, setCustomMode] = useState(() => !isPresetFont(value, kind));
  const [panelOpen, setPanelOpen] = useState(false);
  /** 最近一次在列表里点选的值；它恰好等于某个预设（如 Menlo）时也保持自定义状态 */
  const [pickedValue, setPickedValue] = useState<string | null>(null);

  // 外部把值改掉（例如「恢复默认值」）时同步下拉；列表里自己点出来的值不打断面板
  useEffect(() => {
    if (value === pickedValue) {
      return;
    }
    const preset = isPresetFont(value, kind);
    setCustomMode(!preset);
    if (preset) {
      setPanelOpen(false);
    }
  }, [kind, value, pickedValue]);

  let selectValue = value;
  if (customMode) {
    selectValue = CUSTOM_FONT_OPTION;
  }

  // 切到「自定义…」但还没点字体时，存储值仍是原来的预设，不显示「已选」
  let selectedName = "";
  if (customMode && value !== "") {
    if (!isPresetFont(value, kind) || value === pickedValue) {
      selectedName = customFontName(value, kind);
    }
  }

  function pickFont(next: string) {
    setPickedValue(next);
    onChange(next);
  }

  return (
    <SettingRow
      label={label}
      hint={hint}
      below={customMode && panelOpen ? (
            <div className="motion-axis-y-in">
              <FontListPanel
                kind={kind}
                value={value}
                onPick={pickFont}
                onClose={() => setPanelOpen(false)}
              />
            </div>
          ) : null}
    >
      <Select
        aria-label={label}
        className="min-w-40"
        value={selectValue}
        options={[
          ...options.map((font) => ({ value: font.value, label: font.label })),
          { value: CUSTOM_FONT_OPTION, label: "自定义…" },
        ]}
        onChange={(next) => {
          if (next === CUSTOM_FONT_OPTION) {
            // 先只展开列表，等用户点了字体再改存储值
            setCustomMode(true);
            setPanelOpen(true);
            return;
          }
          setCustomMode(false);
          setPanelOpen(false);
          setPickedValue(null);
          onChange(next);
        }}
      />
      {customMode ? (
        <>
          {selectedName ? (
            <span className="max-w-56 truncate text-sm text-ink" data-tip={selectedName} data-tip-overflow="">
              已选：{selectedName}
            </span>
          ) : (
            <span className="text-sm text-muted">未选择字体</span>
          )}
          <button
            type="button"
            className="motion-colors rounded-control text-sm text-accent outline-none hover:text-accent-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
            onClick={() => setPanelOpen(!panelOpen)}
          >
            {panelOpen ? "收起" : "更换"}
          </button>
        </>
      ) : null}
    </SettingRow>
  );
}

/** Live text inherits the selected UI and monospace font settings. */
function SansFontPreview() {
  return <span className="settings-font-sans">示例文字 Aa 123</span>;
}

function MonoFontPreview() {
  return <span className="font-mono">127.0.0.1:22 · /etc/nginx/nginx.conf</span>;
}

function ShortcutKeys({ keys }: { keys: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {keys.map((key, index) => (
        <span key={key} className="inline-flex items-center gap-1.5">
          {index > 0 ? <span className="text-xs text-muted">或</span> : null}
          <kbd className="rounded-control bg-raised px-2 py-0.5 font-mono text-xs text-ink">
            {key}
          </kbd>
        </span>
      ))}
    </div>
  );
}
