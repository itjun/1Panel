import { useEffect } from "react";
import { RefreshCw, Plus, Settings, Palette, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useApp } from "@/store/app";
import { useSettings, type ThemeKey } from "@/store/settings";

interface TopBarProps {
  onOpenSettings: () => void;
}

const THEME_ORDER: ThemeKey[] = [
  "dark",
  "light",
  "midnight",
  "forest",
  "sakura",
  "auto",
];

export function TopBar({ onOpenSettings }: TopBarProps) {
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

  return (
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Server className="h-4 w-4" />
        </div>
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
      <div className="flex items-center gap-2">
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
        <Button variant="default" size="sm" className="h-8 gap-1.5 text-xs">
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
