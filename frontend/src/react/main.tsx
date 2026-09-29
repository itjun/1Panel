import { createRoot } from "react-dom/client";
import { App } from "@/react/App";
import { BoardPage } from "@/react/pages/board";
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
if (rootEl) {
  applySavedFont();
  rootEl.replaceChildren();
  rootEl.classList.add("react-root");
  const root = createRoot(rootEl);
  const boardGroup = boardGroupFromPath(location.pathname);
  if (boardGroup) {
    document.documentElement.classList.add("board-http");
    root.render(
      <>
        <BoardPage groupId={boardGroup} />
        <TooltipLayer />
      </>,
    );
  } else {
    root.render(
      <>
        <App />
        <TooltipLayer />
      </>,
    );
  }
}
