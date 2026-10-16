import { useLayoutEffect, type RefObject } from "react";
import { createPortal } from "react-dom";

export type DragPoint = { x: number; y: number };
export type HostDragItem = {
  name: string;
  sectionId: string;
  kind: "host" | "group";
};

/** Position updates are frame-batched by usePointerDrag, without rendering the rack. */
export function positionHostDragPreview(element: HTMLDivElement | null, point: DragPoint) {
  if (!element) return;
  const { offsetWidth: width, offsetHeight: height } = element;
  const x = point.x + width + 20 < window.innerWidth ? point.x + 16 : point.x - width - 16;
  const y = point.y + height + 20 < window.innerHeight ? point.y + 16 : point.y - height - 16;
  element.style.transform = `translate3d(${Math.max(8, x)}px, ${Math.max(8, y)}px, 0)`;
}

export function HostDragPreview({ item, elementRef, pointRef }: {
  item: HostDragItem;
  elementRef: RefObject<HTMLDivElement | null>;
  pointRef: RefObject<DragPoint>;
}) {
  useLayoutEffect(() => {
    positionHostDragPreview(elementRef.current, pointRef.current);
  });

  return createPortal(
    <div ref={elementRef} className="host-drag-preview" aria-hidden="true">
      <div className="host-drag-label">{item.name}</div>
    </div>,
    document.body,
  );
}
