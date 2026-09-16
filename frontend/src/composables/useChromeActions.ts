import { inject, type InjectionKey, type Ref } from "vue";

/** 内容列通栏右侧操作槽（由 ChromeScope provide，MainChromeBar 挂载节点） */
export const chromeActionsKey: InjectionKey<Ref<HTMLElement | null>> =
  Symbol("chromeActions");

export function useChromeActionsEl(): Ref<HTMLElement | null> | undefined {
  return inject(chromeActionsKey, undefined);
}
