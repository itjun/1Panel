import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

export type PointerDragOptions = {
  threshold: number;
  onStart: () => void | (() => void);
  onMove: (x: number, y: number) => void;
  onFinish: (cancelled: boolean) => void;
};

type FinishDrag = (cancelled: boolean, notify: boolean) => void;
type ClickGuard = { clear: () => void; nextGesture: () => void };

/** Pointer dragging with a click-preserving threshold and one move callback per frame. */
export function usePointerDrag() {
  const finishRef = useRef<FinishDrag | null>(null);
  const clickGuardRef = useRef<ClickGuard | null>(null);

  useEffect(() => () => {
    // A component may disappear while its pointer is captured. Do not call its
    // callbacks here: they commonly update state owned by the unmounted page.
    finishRef.current?.(true, false);
    clickGuardRef.current?.clear();
  }, []);

  const startDrag = useCallback((event: ReactPointerEvent<HTMLElement>, options: PointerDragOptions): void => {
    if (event.button !== 0 || event.isPrimary === false) return;

    finishRef.current?.(true, true);
    clickGuardRef.current?.nextGesture();

    const target = event.currentTarget;
    const document = target.ownerDocument;
    const window = document.defaultView;
    if (!window) return;

    const pointerId = event.pointerId;
    const originX = event.clientX;
    const originY = event.clientY;
    const threshold = Math.max(0, options.threshold);
    let x = originX;
    let y = originY;
    let active = false;
    let finished = false;
    let frame: number | null = null;
    let restoreBody: (() => void) | null = null;
    let cleanupStartedDrag: (() => void) | null = null;

    function guardReleaseClick(cancelled: boolean) {
      clickGuardRef.current?.clear();
      let timer: number | null = null;
      let releaseClickSeen = false;
      let followingGesture = false;

      function clear() {
        window!.removeEventListener("click", suppressClick, true);
        window!.removeEventListener("dblclick", suppressDoubleClick, true);
        window!.removeEventListener("pointerdown", nextGesture, true);
        window!.removeEventListener("pointerup", released, true);
        window!.removeEventListener("pointercancel", cancelFollowingGesture, true);
        window!.removeEventListener("blur", cancelFollowingGesture);
        if (timer !== null) window!.clearTimeout(timer);
        if (clickGuardRef.current === guard) clickGuardRef.current = null;
      }
      function afterRelease() {
        if (timer !== null) window!.clearTimeout(timer);
        timer = window!.setTimeout(() => {
          timer = null;
          if (followingGesture || !releaseClickSeen) clear();
        }, 0);
      }
      function nextGesture() {
        // Escape can leave the original pointer down. A later independent
        // pointerdown proves that gesture is over, even after blur/pointercancel
        // when no matching pointerup or click ever arrives.
        if (!releaseClickSeen) clear();
        else {
          if (timer !== null) window!.clearTimeout(timer);
          timer = null;
          followingGesture = true;
        }
      }
      function released(pointer: PointerEvent) {
        if (followingGesture || pointer.pointerId === pointerId) afterRelease();
      }
      function cancelFollowingGesture() {
        if (followingGesture) clear();
      }
      function suppressClick(click: MouseEvent) {
        if (click.detail === 0) return;
        if (followingGesture) {
          // Allow this real click, but retain the dblclick guard for its event
          // turn: the browser may count the suppressed drag click as click one.
          afterRelease();
          return;
        }
        if ("pointerId" in click && click.pointerId !== pointerId) return;
        releaseClickSeen = true;
        click.preventDefault();
        click.stopImmediatePropagation();
        afterRelease();
      }
      function suppressDoubleClick(click: MouseEvent) {
        if (!releaseClickSeen) return;
        click.preventDefault();
        click.stopImmediatePropagation();
      }

      const guard = { clear, nextGesture };
      window!.addEventListener("click", suppressClick, true);
      window!.addEventListener("dblclick", suppressDoubleClick, true);
      window!.addEventListener("pointerdown", nextGesture, true);
      window!.addEventListener("pointerup", released, true);
      window!.addEventListener("pointercancel", cancelFollowingGesture, true);
      window!.addEventListener("blur", cancelFollowingGesture);
      clickGuardRef.current = guard;
      // Successful drops already received pointerup. Cancellations wait for
      // release or the next pointerdown, with no polling or persistent timer.
      if (!cancelled) afterRelease();
    }

    function finish(cancelled: boolean, notify: boolean) {
      if (finished) return;
      finished = true;
      if (frame !== null) window!.cancelAnimationFrame(frame);
      frame = null;

      // Releasing capture can synchronously dispatch lostpointercapture. Remove
      // every drag listener first so completion can never re-enter itself.
      window!.removeEventListener("pointermove", move, true);
      window!.removeEventListener("pointerup", up, true);
      window!.removeEventListener("pointercancel", cancelPointer, true);
      window!.removeEventListener("keydown", keyDown, true);
      window!.removeEventListener("blur", cancel);
      target.removeEventListener("lostpointercapture", cancelPointer);
      restoreBody?.();
      if (finishRef.current === finish) finishRef.current = null;
      try {
        if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
      } catch {
        // Capture may already have been released by the browser or a removed node.
      }
      const cleanup = cleanupStartedDrag;
      cleanupStartedDrag = null;
      cleanup?.();

      if (active && notify) {
        guardReleaseClick(cancelled);
        options.onFinish(cancelled);
      }
    }

    function activate() {
      clickGuardRef.current?.clear();
      active = true;
      const body = document.body;
      if (body) {
        const properties = ["user-select", "-webkit-user-select", "cursor"] as const;
        const previous = properties.map((name) => ({
          name,
          value: body.style.getPropertyValue(name),
          priority: body.style.getPropertyPriority(name),
        }));
        restoreBody = () => {
          for (const { name, value, priority } of previous) {
            if (value) body.style.setProperty(name, value, priority);
            else body.style.removeProperty(name);
          }
        };
        body.style.setProperty("user-select", "none", "important");
        body.style.setProperty("-webkit-user-select", "none", "important");
        body.style.setProperty("cursor", "grabbing", "important");
      }
      document.getSelection()?.removeAllRanges();
      try {
        target.setPointerCapture(pointerId);
      } catch {
        // Window listeners still cover dragging when capture is unavailable.
      }
      try {
        const cleanup = options.onStart();
        if (typeof cleanup === "function") {
          // onStart may synchronously unmount its owner or replace this drag.
          if (finished) cleanup();
          else cleanupStartedDrag = cleanup;
        }
      } catch (error) {
        finish(true, false);
        throw error;
      }
    }

    function move(pointer: PointerEvent) {
      if (finished || pointer.pointerId !== pointerId) return;
      x = pointer.clientX;
      y = pointer.clientY;
      if (!active) {
        if (Math.hypot(x - originX, y - originY) < threshold) return;
        activate();
      }
      if (finished) return;
      if (pointer.cancelable) pointer.preventDefault();
      if (frame !== null) return;
      frame = window!.requestAnimationFrame(() => {
        frame = null;
        if (!finished) options.onMove(x, y);
      });
    }

    function up(pointer: PointerEvent) {
      if (finished || pointer.pointerId !== pointerId) return;
      if (!active) {
        finish(false, false);
        return;
      }
      if (pointer.cancelable) pointer.preventDefault();
      if (frame !== null) window!.cancelAnimationFrame(frame);
      frame = null;
      try {
        // Drop targeting must see the release position even if the last move
        // was still waiting for its animation frame.
        options.onMove(pointer.clientX, pointer.clientY);
      } finally {
        finish(false, true);
      }
    }

    function cancelPointer(pointer: PointerEvent) {
      if (pointer.pointerId === pointerId) finish(true, true);
    }

    function cancel() {
      finish(true, true);
    }

    function keyDown(key: KeyboardEvent) {
      if (key.key !== "Escape") return;
      if (active) key.preventDefault();
      cancel();
    }

    finishRef.current = finish;
    window.addEventListener("pointermove", move, { capture: true, passive: false });
    window.addEventListener("pointerup", up, { capture: true, passive: false });
    window.addEventListener("pointercancel", cancelPointer, true);
    window.addEventListener("keydown", keyDown, true);
    window.addEventListener("blur", cancel);
    target.addEventListener("lostpointercapture", cancelPointer);
  }, []);

  return { startDrag };
}
