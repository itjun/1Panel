import { createRoot } from "react-dom/client";
import { App } from "@/react/App";
import { BoardPage } from "@/react/pages/board";
import { applySavedFont } from "@/react/lib/utils";
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
  const params = new URLSearchParams(location.search);
  const mode = params.get("mode");
  const root = createRoot(rootEl);
  if (mode === "board") {
    root.render(<BoardPage groupId={params.get("groupId") || ""} />);
  } else {
    root.render(<App />);
  }
}
