// INTEGRATION: entry 改为使用本文件的 SettingsPage。
import { Events } from "@wailsio/runtime";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/api";
import appIcon from "@/react/assets/appicon.png";
import { isWindowsPlatform } from "@/react/lib/platform";
import {
  HostBackupRestoreDialog,
  exportHostBackup,
  pickHostBackupFile,
} from "@/react/components/backup/host-backup";
import { DistroBadge } from "@/react/components/distro-badge";
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
import { formatErr } from "@/utils/format";

export function SettingsPage() {
  const session = useSession();
  const settings = useSettings();
  const [ask, setAsk] = useState(true);
  const flash = useFlashMessage();
  const [boardEnabled, setBoardEnabled] = useState(true);
  const [boardPort, setBoardPort] = useState(8888);
  const [restorePath, setRestorePath] = useState<string | null>(null);
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
    settings.appearance !== SETTINGS_DEFAULTS.appearance ||
    settings.fontFamily !== SETTINGS_DEFAULTS.fontFamily ||
    settings.monoFontFamily !== SETTINGS_DEFAULTS.monoFontFamily ||
    settings.fontSize !== SETTINGS_DEFAULTS.fontSize ||
    settings.startupPage !== SETTINGS_DEFAULTS.startupPage ||
    !ask;

  const section = session.settingsSection;

  return (
    <Page
      title="设置"
      actions={
        section === "look" || section === "session" ? (
          <Button
            size="sm"
            disabled={!changed}
            onClick={() => {
              resetSettings();
              void api.setAskBeforeQuit(true).then(() => setAsk(true));
            }}
          >
            恢复默认值
          </Button>
        ) : undefined
      }
    >
      {/* 外层 Page 已给 16px 安全边距，这里只负责居中与分区间距（8 点网格） */}
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-section">
        <FlashNotices flash={flash} />
        <HostBackupRestoreDialog
          path={restorePath}
          onClose={() => setRestorePath(null)}
          onRestored={(message) => flash.showToast(message)}
          onError={(message) => flash.showError(message)}
        />

        {section === "look" ? (
          <section className="flex flex-col">
            <h2 className="mb-2 text-sm font-semibold text-ink">外观</h2>
            <SettingRow label="主题" hint="改完立刻生效">
              <RadioGroup
                aria-label="主题"
                value={settings.appearance}
                onChange={(appearance) => updateSettings({ appearance })}
                options={[
                  { value: "light", label: "白色" },
                  { value: "dark", label: "黑色" },
                  { value: "system", label: "跟随系统" },
                ]}
              />
            </SettingRow>
          </section>
        ) : null}

        {section === "look" ? (
          <section className="flex flex-col">
            <h2 className="mb-1 text-sm font-semibold text-ink">字体</h2>
            <p className="m-0 mb-2 text-xs text-muted">
              默认使用系统字体（Mac 为 SF + 苹方）；选择只保存在本机，不同电脑可以各自设置。改完立刻生效。
            </p>
            <FontSettingRow
              label="界面字体"
              hint="用在菜单和侧栏、按钮、主机名和分组名、表格里的普通文字、提示条、弹窗"
              kind="sans"
              value={settings.fontFamily}
              onChange={(value) => updateSettings({ fontFamily: value })}
              preview={<SansFontPreview />}
            />
            <FontSettingRow
              label="等宽字体"
              hint="用在 IP 地址和端口、版本号、CPU / 内存等数值、文件路径和大小、日志、配置编辑器（SSH 配置、JSON）"
              kind="mono"
              value={settings.monoFontFamily}
              onChange={(value) => updateSettings({ monoFontFamily: value })}
              preview={<MonoFontPreview />}
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
          </section>
        ) : null}

        {section === "session" ? (
          <section className="flex flex-col">
            <h2 className="mb-2 text-sm font-semibold text-ink">会话</h2>
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
          </section>
        ) : null}

        {section === "board" ? (
          <section className="flex flex-col">
            <h2 className="mb-2 text-sm font-semibold text-ink">看板</h2>
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
          </section>
        ) : null}

        {section === "app" ? (
          <section className="flex flex-col">
            <h2 className="mb-2 text-sm font-semibold text-ink">应用</h2>
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
            {isWindowsPlatform() ? (
              <SettingRow
                label="终端打开方式"
                hint="「终端打开」主机时的窗口行为；连接由系统 OpenSSH 按本机 SSH 配置建立"
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
          </section>
        ) : null}

        {section === "about" ? <AboutSection /> : null}

        {section === "shortcuts" ? (
          <section className="flex flex-col">
            <h2 className="mb-2 text-sm font-semibold text-ink">快捷键</h2>
            <div className="overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="h-table-head border-b border-line text-xs text-muted">
                    <th className="px-3 font-normal">功能</th>
                    <th className="px-3 font-normal">Windows</th>
                    <th className="px-3 font-normal">Mac</th>
                  </tr>
                </thead>
                <tbody>
                  {SHORTCUT_ROWS.map((row) => (
                    <tr key={row.label} className="h-table-row border-b border-line last:border-b-0">
                      <td className="px-3 text-ink">{row.label}</td>
                      <td className="px-3">
                        <ShortcutKeys keys={row.win} />
                      </td>
                      <td className="px-3">
                        <ShortcutKeys keys={row.mac} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    </Page>
  );
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
      <h2 className="mb-2 text-sm font-semibold text-ink">关于</h2>
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
      <SettingRow label="链接" hint="用系统浏览器打开">
        <Button size="sm" onClick={() => void api.openExternalURL(info?.repoUrl || "")}>
          源码仓库
        </Button>
        <Button size="sm" onClick={() => void api.openExternalURL(info?.releasesUrl || "")}>
          检查更新
        </Button>
        <Button size="sm" onClick={() => void api.openExternalURL(info?.issuesUrl || "")}>
          问题反馈
        </Button>
      </SettingRow>
    </section>
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

const SHORTCUT_ROWS: { label: string; win: string[]; mac: string[] }[] = [
  { label: "展开 / 收起侧栏", win: ["Ctrl+B", "Ctrl+\\"], mac: ["⌘+B", "⌘+\\"] },
  { label: "打开设置", win: ["Ctrl+,"], mac: ["⌘+,"] },
  { label: "后退", win: ["Alt+←"], mac: ["⌘+[", "⌘+←"] },
  { label: "前进", win: ["Alt+→"], mac: ["⌘+]", "⌘+→"] },
];

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
    <div className="flex min-h-14 flex-wrap items-center justify-between gap-4 border-b border-line py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="text-sm text-ink">{label}</div>
        {hint ? <div className="mt-0.5 text-xs text-muted">{hint}</div> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {below ? <div className="basis-full">{below}</div> : null}
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
  preview,
}: {
  label: string;
  hint: string;
  kind: FontKind;
  value: string;
  onChange: (value: string) => void;
  preview: ReactNode;
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
      below={
        <>
          {customMode && panelOpen ? (
            <div className="motion-axis-y-in">
              <FontListPanel
                kind={kind}
                value={value}
                onPick={pickFont}
                onClose={() => setPanelOpen(false)}
              />
            </div>
          ) : null}
          {preview}
        </>
      }
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

/**
 * 界面字体场景预览：一个迷你侧栏项 + 一个机柜分组的主机行。
 * 纯展示，不可点、不参与 Tab 聚焦；直接继承页面当前字体，选什么就显示什么。
 */
function SansFontPreview() {
  return (
    <div
      className="flex flex-wrap items-center gap-4 rounded-control bg-raised p-3 select-none"
      aria-hidden="true"
    >
      <div className="rail-item-active flex h-10 w-32 items-center rounded-control px-3 text-sm">
        主机
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex h-9 items-center gap-2 px-1">
          <span className="text-sm font-semibold text-ink">01-cdcp-main</span>
          <span className="text-xs tabular-nums text-muted">7</span>
        </div>
        <div className="flex h-10 items-center gap-2.5 rounded-control bg-surface px-2">
          <DistroBadge boxSize={22} osRelease="Ubuntu 22.04.5 LTS" />
          <span className="text-ink">cdcp-main</span>
        </div>
      </div>
    </div>
  );
}

/**
 * 等宽字体场景预览：两行迷你表格（IP:端口 / 版本 / CPU / 路径）看数字是否对齐，
 * 外加两行配置片段看路径与符号是否清楚。走 font-mono，跟随 --app-font-mono。
 */
function MonoFontPreview() {
  return (
    <div
      className="flex flex-col gap-3 rounded-control bg-raised p-3 select-none"
      aria-hidden="true"
    >
      <div className="grid grid-cols-[auto_auto_auto_1fr] gap-x-4 gap-y-1 font-mono text-sm text-ink tabular-nums">
        <span>192.168.10.34:22</span>
        <span>22.04.5 LTS</span>
        <span className="text-right">CPU 12.5%</span>
        <span className="truncate text-muted">/etc/nginx/nginx.conf</span>
        <span>10.0.80.17:2222</span>
        <span>12.9</span>
        <span className="text-right">CPU 3.8%</span>
        <span className="truncate text-muted">/var/log/nginx/access.log</span>
      </div>
      <pre className="m-0 rounded-control bg-graphite p-2 font-mono text-sm text-graphite-text">
        {"Host cdcp-main\n  HostName 192.168.10.34"}
      </pre>
    </div>
  );
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
