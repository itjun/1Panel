import { useEffect } from "react";
import { RefreshCw, Plus, Settings, Palette, PanelLeft } from "lucide-react";
import { WindowToggleMaximise } from "@wailsjs/runtime/runtime";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AppLogo } from "@/components/common/AppLogo";
import { useApp } from "@/store/app";
import { useSettings, type ThemeKey } from "@/store/settings";
import { cn } from "@/lib/utils";

interface TopBarProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onOpenSettings: () => void;
  onOpenAddHost: () => void;
}

const THEME_ORDER: ThemeKey[] = [
  "dark",
  "light",
  "midnight",
  "forest",
  "sakura",
  "auto",
];

export function TopBar({
  sidebarOpen,
  onToggleSidebar,
  onOpenSettings,
  onOpenAddHost,
}: TopBarProps) {
  const { refresh, loading } = useApp();
  const { settings, updateSettings } = useSettings();

  const cycleTheme = () => {
    const idx = THEME_ORDER.indexOf(settings.theme);
    const next = THEME_ORDER[(idx + 1) % THEME_ORDER.length];
    updateSettings({ theme: next });
  };

  // 全局 Cmd+, 已经在 App.tsx 处理；这里只做 cmd + shift + t 快速切主题
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        cycleTheme();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [settings.theme]);

  // 双击标题栏空白区域：切换最大化（Wails 拖拽层本身不处理双击放大）
  const handleTitleBarDoubleClick = (e: React.MouseEvent) => {
    const el = e.target as HTMLElement | null;
    if (!el) return;
    // 点在 no-drag 控件上不触发（按钮等）
    const style = window.getComputedStyle(el);
    if (style.getPropertyValue("--wails-draggable").trim() === "no-drag") {
      return;
    }
    try {
      WindowToggleMaximise();
    } catch {
      // dev 浏览器预览时 runtime 可能不可用
    }
  };

  return (
    <div
      className="drag-region flex h-12 shrink-0 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur"
      onDoubleClick={handleTitleBarDoubleClick}
    >
      {/* 左侧：红绿灯占位 + 控件。仅按钮 no-drag，标题/日期保留可拖 */}
      <div className="flex items-center gap-2" style={{ paddingLeft: "70px" }}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="no-drag h-8 w-8"
              onClick={onToggleSidebar}
            >
              <PanelLeft
                className={cn(
                  "h-4 w-4",
                  sidebarOpen ? "text-foreground" : "text-muted-foreground"
                )}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {sidebarOpen ? "收起侧边栏" : "展开侧边栏"}
          </TooltipContent>
        </Tooltip>

        <AppLogo sizeClassName="h-7 w-7" className="rounded-md" />
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight">iPannel</span>
          <span className="text-[10px] text-muted-foreground">运维管理</span>
        </div>
        <span className="ml-3 text-xs font-medium text-muted-foreground">
          {new Date().toLocaleDateString("zh-CN", {
            month: "long",
            day: "numeric",
            weekday: "short",
          })}
        </span>
      </div>

      {/* 中间弹性空白：主要拖拽区 */}
      <div className="h-full min-w-8 flex-1" />

      {/* 右侧操作：全部 no-drag，保证可点 */}
      <div className="no-drag flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={cycleTheme}
            >
              <Palette className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            切换主题（当前：{settings.theme}）
          </TooltipContent>
        </Tooltip>

        <Button
          variant="ghost"
          size="sm"
          onClick={refresh}
          disabled={loading}
          className="h-8 gap-1.5 text-xs"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          刷新
        </Button>
        <Button
          variant="default"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={onOpenAddHost}
        >
          <Plus className="h-3.5 w-3.5" />
          添加主机
        </Button>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onOpenSettings}
            >
              <Settings className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">设置（⌘ + ,）</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
