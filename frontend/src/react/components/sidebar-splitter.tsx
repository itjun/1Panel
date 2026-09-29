/**
 * Firefox 式侧栏分割条：拖动改宽（带竖线引导），双击恢复默认宽度。
 */

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useSidebar } from "@/react/state/sidebar";

export function SidebarSplitter() {
  const sidebar = useSidebar();
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const [active, setActive] = useState(false);

  useEffect(() => {
    function onMove(event: PointerEvent) {
      if (!draggingRef.current) return;
      const delta = event.clientX - startXRef.current;
      const next = Math.min(
        sidebar.widthMax,
        Math.max(sidebar.widthMin, Math.round(startWidthRef.current + delta)),
      );
      sidebar.setWidth(next);
    }

    function onUp() {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setActive(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [sidebar.setWidth, sidebar.widthMin, sidebar.widthMax]);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    draggingRef.current = true;
    startXRef.current = event.clientX;
    startWidthRef.current = sidebar.width;
    setActive(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={sidebar.width}
      aria-valuemin={sidebar.widthMin}
      aria-valuemax={sidebar.widthMax}
      aria-label="调整侧栏宽度"
      data-tip="拖动调整宽度 · 双击恢复默认"
      className={`sidebar-splitter relative z-20 w-0 shrink-0 ${active ? "is-active" : ""}`}
      onPointerDown={onPointerDown}
      onDoubleClick={(event) => {
        event.preventDefault();
        sidebar.resetWidth();
      }}
    >
      <div className="sidebar-splitter-hit absolute inset-y-0 -left-1 w-2 cursor-col-resize" />
      {/* hover / is-active 的竖线颜色由 globals.css 控制 */}
      <div className="sidebar-splitter-line pointer-events-none absolute inset-y-0 -left-px w-0.5" />
    </div>
  );
}
