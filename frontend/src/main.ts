import { createApp } from "vue";
import { createPinia } from "pinia";
// 暗色模式 CSS 变量（按需组件不带 dark css-vars）
import "element-plus/theme-chalk/dark/css-vars.css";
import "@/styles/index.scss";
import App from "./App.vue";

// 屏蔽 WebView 默认右键菜单（Reload / Inspect Element）
// 误点 Reload 会硬刷页面，Wails 桥与会话状态易白屏；业务区如需自定义菜单可在元素上 stopPropagation
document.addEventListener(
  "contextmenu",
  (e) => {
    e.preventDefault();
  },
  { capture: true }
);

const app = createApp(App);
app.use(createPinia());
app.mount("#app");
