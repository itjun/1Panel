import { inject, type InjectionKey, type Ref } from "vue";

/** 内容列通栏右侧操作槽（由 ChromeScope provide，MainChromeBar 挂载节点） */
export const chromeActionsKey: InjectionKey<Ref<HTMLElement | null>> =
  Symbol("chromeActions");

/** 内容列通栏正中槽（标题与右侧操作之间居中） */
export const chromeCenterKey: InjectionKey<Ref<HTMLElement | null>> =
  Symbol("chromeCenter");

export function useChromeActionsEl(): Ref<HTMLElement | null> | undefined {
  return inject(chromeActionsKey, undefined);
}

export function useChromeCenterEl(): Ref<HTMLElement | null> | undefined {
  return inject(chromeCenterKey, undefined);
}
