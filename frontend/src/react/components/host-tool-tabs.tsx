/**
 * HostToolTabs — 整窗通栏里的主机功能标签（DESIGN.md §4.6）。
 * 侧栏只负责选主机，通栏负责选功能；标签顺序即 HOST_TOOLS 顺序。
 */

import { cn } from "@/react/lib/utils";
import { HOST_TOOLS, useSession } from "@/react/state/session";

/** 当前是否在某台主机的功能页：通栏显示功能标签，页面操作下沉到内容区。 */
export function useIsHostWorkspace(): boolean {
  const session = useSession();
  return !session.settingsOpen && session.workspace === "remote" && !!session.activeHost;
}

export function HostToolTabs() {
  const session = useSession();

  return (
    <div
      role="tablist"
      aria-label="主机功能"
      className="pointer-events-auto flex h-full min-w-0 shrink items-stretch overflow-x-auto pl-2"
    >
      {HOST_TOOLS.map((tool) => {
        const active = session.activeTool === tool.id;
        return (
          <button
            key={tool.id}
            type="button"
            role="tab"
            aria-selected={active}
            // 统一按 4 个汉字宽（56px 文字 + 两侧各 4px）等宽排列，选中只变色不加粗，避免字宽跳动
            className={cn(
              "motion-colors flex w-16 shrink-0 items-center justify-center text-sm whitespace-nowrap",
              active ? "text-accent" : "text-muted hover:text-ink",
            )}
            onClick={() => session.setTool(tool.id)}
          >
            {tool.label}
          </button>
        );
      })}
    </div>
  );
}
