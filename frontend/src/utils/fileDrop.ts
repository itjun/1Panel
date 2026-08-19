/**
 * 文件拖放分发器（Wails v3）。
 *
 * v2 时代前端用 OnFileDrop 注册全局单回调，后注册者覆盖先注册者；
 * v3 中文件拖放由后端转发为 "file:drop" 自定义事件，所有订阅者都会收到。
 * 为保持 v2 语义（最活跃的视图接收拖放），这里实现 LIFO 栈式分发：
 *   - 视图挂载/激活时 registerFileDrop(handler) 入栈
 *   - 卸载/失活时调用返回的退订函数出栈
 *   - 事件到达时只投递给栈顶 handler
 *
 * 事件监听器只初始化一次（懒初始化，保证 runtime 已就绪）。
 */
import { Events } from "@wailsio/runtime";

type DropHandler = (paths: string[]) => void;

const stack: DropHandler[] = [];
let initialized = false;

function initFileDrop(): void {
  if (initialized) return;
  initialized = true;
  Events.On("file:drop", (ev: { data?: unknown }) => {
    const paths = Array.isArray(ev?.data) ? (ev.data as string[]) : [];
    if (paths.length === 0) return;
    const handler = stack[stack.length - 1];
    handler?.(paths);
  });
}

/** 注册一个拖放处理器；返回退订函数（幂等，可重复调用） */
export function registerFileDrop(handler: DropHandler): () => void {
  initFileDrop();
  stack.push(handler);
  return () => {
    const i = stack.lastIndexOf(handler);
    if (i >= 0) stack.splice(i, 1);
  };
}
