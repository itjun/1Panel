import { Check, RotateCcw } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import {
  FONT_OPTIONS,
  THEME_OPTIONS,
  useSettings,
  type ThemeKey,
} from "@/store/settings";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const { settings, updateSettings, resetSettings } = useSettings();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="设置"
      width="640px"
    >
      <div className="space-y-6">
        {/* 主题 */}
        <section>
          <h3 className="mb-1 text-xs font-semibold text-foreground">
            主题
          </h3>
          <p className="mb-3 text-[11px] text-muted-foreground">
            选择整体配色方案。「跟随系统」会按系统外观自动切换亮/暗。
          </p>
          <div className="grid grid-cols-3 gap-2.5">
            {THEME_OPTIONS.map((t) => {
              const active = settings.theme === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => updateSettings({ theme: t.key as ThemeKey })}
                  data-state={active ? "active" : "inactive"}
                  className={cn(
                    "group relative overflow-hidden rounded p-3 text-left transition-all",
                    active
                      ? "panel-card-selectable-active"
                      : "panel-card-selectable"
                  )}
                >
                  {/* 预览色板 */}
                  <div
                    className="mb-2 flex h-12 items-center justify-center rounded-md border border-border/50"
                    style={{ background: t.swatch.bg }}
                  >
                    <div
                      className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                      style={{
                        background: t.swatch.accent,
                        color: t.swatch.fg,
                      }}
                    >
                      Aa
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-medium">{t.name}</div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        {t.description}
                      </div>
                    </div>
                    {active && (
                      <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* 字体类型 */}
        <section>
          <h3 className="mb-1 text-xs font-semibold">字体类型</h3>
          <p className="mb-2 text-[11px] text-muted-foreground">
            字体立刻应用到全局。等宽字体更适合命令行场景。
          </p>
          <select
            value={settings.fontFamily}
            onChange={(e) => updateSettings({ fontFamily: e.target.value })}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs outline-none focus:border-primary"
          >
            {FONT_OPTIONS.map((f) => (
              <option key={f.label} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </section>

        {/* 字号 */}
        <section>
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-xs font-semibold">字体大小</h3>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {settings.fontSize}px
            </span>
          </div>
          <p className="mb-2 text-[11px] text-muted-foreground">
            调整全局字号。建议 12~14。
          </p>
          <Slider
            value={settings.fontSize}
            min={10}
            max={18}
            step={1}
            onChange={(v) => updateSettings({ fontSize: v })}
          />
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
            <span>10px</span>
            <span>14px</span>
            <span>18px</span>
          </div>
        </section>

        {/* 页面缩放 */}
        <section>
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-xs font-semibold">页面缩放</h3>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {settings.zoom}%
            </span>
          </div>
          <p className="mb-2 text-[11px] text-muted-foreground">
            整体缩放所有 UI 元素（含图表）。
          </p>
          <Slider
            value={settings.zoom}
            min={80}
            max={140}
            step={5}
            onChange={(v) => updateSettings({ zoom: v })}
          />
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
            <span>80%</span>
            <span>100%</span>
            <span>140%</span>
          </div>
        </section>

        {/* 操作 */}
        <div className="flex items-center justify-between border-t border-border pt-4">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => resetSettings()}
          >
            <RotateCcw className="h-3 w-3" />
            恢复默认
          </Button>
          <Button
            size="sm"
            className="h-8 text-xs"
            onClick={onClose}
          >
            完成
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
