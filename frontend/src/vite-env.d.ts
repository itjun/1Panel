/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

// @wailsjs/go/main/App 与 @wailsjs/go/models 的类型由 wails 自动生成的
// frontend/wailsjs/** 提供（tsconfig paths 已映射），不要在此手写声明遮蔽，
// 否则新增 Go 绑定会类型漂移（历史上曾因此被迫走 wailsMain 运行时绕行）。
