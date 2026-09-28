/**
 * Firefox 式整窗通栏：导航钮在红绿灯旁，页面标题/操作挂到同一条栏的右侧槽位。
 */

import {
  createContext,
  useContext,
  useState,
  type ReactNode,
  type RefCallback,
} from "react";
import { createPortal } from "react-dom";

type ShellToolbarContextValue = {
  slot: HTMLElement | null;
  setSlot: RefCallback<HTMLElement>;
};

const ShellToolbarContext = createContext<ShellToolbarContextValue | null>(null);

export function ShellToolbarProvider({ children }: { children: ReactNode }) {
  const [slot, setSlotState] = useState<HTMLElement | null>(null);
  const setSlot: RefCallback<HTMLElement> = (node) => {
    setSlotState(node);
  };
  return (
    <ShellToolbarContext.Provider value={{ slot, setSlot }}>
      {children}
    </ShellToolbarContext.Provider>
  );
}

export function useShellToolbarSlot() {
  const ctx = useContext(ShellToolbarContext);
  if (!ctx) throw new Error("useShellToolbarSlot requires ShellToolbarProvider");
  return ctx;
}

/** 把页面通栏内容挂到整窗顶栏右侧（导航钮右边）。 */
export function ShellToolbarPortal({ children }: { children: ReactNode }) {
  const { slot } = useShellToolbarSlot();
  if (!slot) return null;
  return createPortal(children, slot);
}
