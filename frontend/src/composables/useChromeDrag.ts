import { inject, type InjectionKey, type Ref } from "vue";

export type ChromeDragApi = {
  openMenu: (e: MouseEvent) => void;
  toggleMaximise: () => void | Promise<void>;
  minimiseWin: () => void;
  hideToBackground: () => void;
  maximised: Ref<boolean>;
  isMac: boolean;
  kbd: (key: string) => string;
};

export const chromeDragKey: InjectionKey<ChromeDragApi> = Symbol("chromeDrag");

export function useChromeDrag(): ChromeDragApi {
  const api = inject(chromeDragKey);
  if (!api) {
    throw new Error("useChromeDrag() 须在 App 提供 chromeDrag 之后使用");
  }
  return api;
}
