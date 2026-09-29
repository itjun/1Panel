import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { api } from "@/api";
import { Checkbox } from "@/react/components/ui/checkbox";
import {
  customFontName,
  customFontValue,
  fontValueWithFallback,
  isPresetFont,
  type FontKind,
} from "@/react/lib/fonts";
import { formatErr } from "@/utils/format";

type SystemFont = { family: string; monospace: boolean };

/**
 * 本机字体家族列表：只在首次展开面板时请求，两个字体行共用同一份缓存；
 * 后端进程内也只读一次，所以这里不需要重新拉取。
 */
function useSystemFonts() {
  return useQuery({
    queryKey: ["system-fonts"],
    queryFn: (): Promise<SystemFont[]> => api.listSystemFonts(),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
}

/** 用该字体自身渲染；名字加引号，缺字时回落到系统栈 */
function familyStyle(family: string, kind: FontKind) {
  const quoted = `"${family.replace(/"/g, '\\"')}"`;
  return { fontFamily: fontValueWithFallback(quoted, kind) };
}

/**
 * 「自定义…」展开的本机字体列表：搜索 + 只看等宽 + 列表，点一项即保存。
 * 读取失败时退回手填字体名输入框，保证功能可用。
 */
export function FontListPanel({
  kind,
  value,
  onPick,
  onClose,
}: {
  kind: FontKind;
  /** 当前存储值 */
  value: string;
  onPick: (value: string) => void;
  onClose: () => void;
}) {
  const fonts = useSystemFonts();
  const [query, setQuery] = useState("");
  const [monoOnly, setMonoOnly] = useState(kind === "mono");
  const [highlight, setHighlight] = useState(-1);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // 预设值（如「苹方」）也能在列表里对上勾；只有自定义值才提示「本机未安装」
  let currentName = "";
  if (value !== "") {
    currentName = customFontName(value, kind);
  }
  const currentKey = currentName.toLowerCase();

  const allFonts = fonts.data ?? [];
  const keyword = query.trim().toLowerCase();
  const filtered = allFonts.filter((font) => {
    if (monoOnly && !font.monospace) {
      return false;
    }
    if (keyword && !font.family.toLowerCase().includes(keyword)) {
      return false;
    }
    return true;
  });

  let currentMissing = false;
  if (currentName && fonts.isSuccess && !isPresetFont(value, kind)) {
    currentMissing = !allFonts.some((font) => font.family.toLowerCase() === currentKey);
  }

  // 搜索词或筛选变了，高亮回到第一项
  useEffect(() => {
    setHighlight(-1);
  }, [keyword, monoOnly]);

  useEffect(() => {
    if (highlight >= 0) {
      itemRefs.current[highlight]?.scrollIntoView({ block: "nearest" });
    }
  }, [highlight]);

  function pick(family: string) {
    onPick(customFontValue(family, kind));
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (filtered.length === 0) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight(Math.min(highlight + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight(Math.max(highlight - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      let index = highlight;
      if (index < 0) {
        index = 0;
      }
      pick(filtered[index].family);
    }
  }

  if (fonts.isError) {
    return (
      <div className="mb-3 flex flex-col gap-2 rounded-panel bg-raised p-3">
        <p className="m-0 text-xs text-muted">
          读取本机字体失败（{formatErr(fonts.error)}），可以直接填写本机已安装的字体名。
        </p>
        <ManualFontInput kind={kind} value={value} onPick={onPick} />
      </div>
    );
  }

  let sample = "主机 cdcp-main";
  if (kind === "mono") {
    sample = "192.168.10.34 12.5%";
  }

  return (
    <div className="mb-3 flex flex-col gap-2 rounded-panel bg-raised p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          autoFocus
          className="motion-field motion-field-on-raised h-8 min-w-0 flex-1 rounded-control px-2 text-sm"
          placeholder="搜索本机字体"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onSearchKeyDown}
        />
        <Checkbox checked={monoOnly} onChange={setMonoOnly}>
          只看等宽字体
        </Checkbox>
        <span className="min-w-12 text-right text-xs tabular-nums text-muted">
          {fonts.isSuccess ? `${filtered.length} 个` : ""}
        </span>
      </div>

      <div className="max-h-[280px] overflow-y-auto rounded-control bg-surface p-1">
        {currentMissing ? (
          <div className="flex h-9 items-center px-2 text-sm text-muted">
            {currentName}（本机未安装，当前显示系统默认）
          </div>
        ) : null}
        {fonts.isPending ? (
          <div className="flex h-9 items-center px-2 text-sm text-muted">正在读取本机字体…</div>
        ) : null}
        {fonts.isSuccess && filtered.length === 0 ? (
          <div className="flex h-9 items-center px-2 text-sm text-muted">没有匹配的字体</div>
        ) : null}
        {filtered.map((font, index) => {
          const selected = font.family.toLowerCase() === currentKey;
          let stateClass = "text-ink hover:bg-raised";
          if (selected) {
            stateClass = "bg-accent-soft text-accent";
          } else if (index === highlight) {
            stateClass = "bg-raised text-ink";
          }
          return (
            <button
              key={font.family}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              type="button"
              className={`motion-colors flex h-9 w-full items-center gap-2 rounded-control px-2 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent ${stateClass}`}
              onClick={() => pick(font.family)}
              onMouseEnter={() => setHighlight(index)}
            >
              <span className="flex w-4 shrink-0 items-center justify-center">
                {selected ? <Check size={14} aria-hidden="true" /> : null}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm" style={familyStyle(font.family, kind)}>
                {font.family}
              </span>
              <span
                className="shrink-0 truncate text-xs text-muted"
                style={familyStyle(font.family, kind)}
                aria-hidden="true"
              >
                {sample}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 兜底：读取字体列表失败时手填字体名，输入即生效 */
function ManualFontInput({
  kind,
  value,
  onPick,
}: {
  kind: FontKind;
  value: string;
  onPick: (value: string) => void;
}) {
  const [draft, setDraft] = useState(() => {
    if (!isPresetFont(value, kind)) {
      return customFontName(value, kind);
    }
    return "";
  });

  let placeholder = "本机已装字体名，如 LXGW WenKai";
  if (kind === "mono") {
    placeholder = "本机已装字体名，如 Maple Mono NF CN";
  }

  return (
    <input
      type="text"
      className="motion-field motion-field-on-raised h-8 w-64 rounded-control px-2 text-sm"
      placeholder={placeholder}
      value={draft}
      onChange={(event) => {
        const text = event.target.value;
        setDraft(text);
        if (text.trim()) {
          onPick(customFontValue(text, kind));
        }
      }}
    />
  );
}
