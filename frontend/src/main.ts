import { createApp, nextTick } from "vue";
import { createPinia } from "pinia";
import ElementPlus from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import * as ElementPlusIconsVue from "@element-plus/icons-vue";
import { Events } from "@wailsio/runtime";
import "element-plus/dist/index.css";
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
const pinia = createPinia();

for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component);
}

app.use(pinia);
app.use(ElementPlus, { locale: zhCn, size: "default" });
app.mount("#app");

// 首屏画完只通知 Go：由 Go 在 Hidden 期间先定好尺寸再 Show，避免小窗被拽大
void nextTick(() => {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      void Events.Emit("ui-ready", null);
    });
  });
});
