import { createRoot } from "react-dom/client";
import { hasDesktopBridge, restoreApplicationPreferences } from "@/react/lib/application-data";
import { TooltipLayer } from "@/react/components/ui/tooltip";
import { applySavedFont } from "@/react/lib/utils";
import { boardGroupFromPath } from "@/api/board-http";
import "@/react/styles/globals.css";

document.addEventListener(
  "contextmenu",
  (event) => {
    event.preventDefault();
  },
  { capture: true },
);

const rootEl = document.getElementById("app");
async function start() {
  if (!rootEl) return;
  const boardGroup = boardGroupFromPath(location.pathname);
  if (!boardGroup && hasDesktopBridge()) await restoreApplicationPreferences();
  applySavedFont();
  rootEl.replaceChildren();
  rootEl.classList.add("react-root");
  const root = createRoot(rootEl);
  if (boardGroup) {
    const { BoardPage } = await import("@/react/pages/board");
    document.documentElement.classList.add("board-http");
    root.render(
      <>
        <BoardPage groupId={boardGroup} />
        <TooltipLayer />
      </>,
    );
  } else {
    const { App } = await import("@/react/App");
    root.render(
      <>
        <App />
        <TooltipLayer />
      </>,
    );
  }
}
void start().catch((error: unknown) => {
  if (!rootEl) return;
  const message = document.createElement("p");
  message.textContent = `应用数据加载失败：${error instanceof Error ? error.message : String(error)}`;
  const retry = document.createElement("button");
  retry.textContent = "重新加载";
  retry.onclick = () => location.reload();
  rootEl.replaceChildren(message, retry);
});
