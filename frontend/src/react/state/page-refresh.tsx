/**
 * 当前页把刷新回调挂到这里；红绿灯旁刷新图标优先跑页级逻辑，无注册时回退 session.refresh。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSession } from "@/react/state/session";

type RefreshHandler = () => void | Promise<void>;

type PageRefreshValue = {
  busy: boolean;
  run: () => Promise<void>;
  register: (handler: RefreshHandler | null, busy?: boolean) => void;
};

const PageRefreshContext = createContext<PageRefreshValue | null>(null);

export function PageRefreshProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const handlerRef = useRef<RefreshHandler | null>(null);
  const [busy, setBusy] = useState(false);

  const register = useCallback((handler: RefreshHandler | null, nextBusy = false) => {
    handlerRef.current = handler;
    setBusy(!!handler && nextBusy);
  }, []);

  const run = useCallback(async () => {
    const handler = handlerRef.current;
    if (handler) {
      await handler();
      return;
    }
    await session.refresh();
  }, [session]);

  const value = useMemo(() => ({ busy, run, register }), [busy, run, register]);
  return <PageRefreshContext.Provider value={value}>{children}</PageRefreshContext.Provider>;
}

export function usePageRefresh() {
  const value = useContext(PageRefreshContext);
  if (!value) throw new Error("usePageRefresh 必须在 PageRefreshProvider 内使用");
  return value;
}

/** 挂载时注册页级刷新；卸载或 handler 清空时撤销。handler 用 ref，避免内联函数反复注册。 */
export function useRegisterPageRefresh(
  handler: RefreshHandler | undefined,
  busy = false,
) {
  const { register } = usePageRefresh();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const hasHandler = !!handler;

  useEffect(() => {
    if (!hasHandler) {
      register(null, false);
      return () => register(null, false);
    }
    const wrapped: RefreshHandler = () => handlerRef.current?.();
    register(wrapped, busy);
    return () => register(null, false);
  }, [hasHandler, busy, register]);
}
