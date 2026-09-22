import { createApp } from "vue";
import { createPinia } from "pinia";
import "element-plus/es/components/message/style/css";
import "element-plus/es/components/message-box/style/css";
import "element-plus/es/components/notification/style/css";
import "element-plus/es/components/loading/style/css";
import "@/styles/index.scss";
import { vTip, installFastTipDelegation } from "@/directives/tip";

// 屏蔽 WebView 默认右键菜单（Reload / Inspect Element）
// 误点 Reload 会硬刷页面，Wails 桥与会话状态易白屏；业务区如需自定义菜单可在元素上 stopPropagation
document.addEventListener(
  "contextmenu",
  (e) => {
    e.preventDefault();
  },
  { capture: true }
);

function mountRoot(comp: Parameters<typeof createApp>[0]) {
  const app = createApp(comp);
  app.use(createPinia());
  app.directive("tip", vTip);
  installFastTipDelegation();
  app.mount("#app");
}

const params = new URLSearchParams(location.search);
if (params.get("mode") === "board") {
  // 看板独立窗：不挂主壳 App.vue
  void import("./components/board/BoardWindowApp.vue").then((m) => {
    mountRoot(m.default);
  });
} else if (params.get("mode") === "terminal") {
  // 用户明确右键或拖拽后才进入的终端独立窗
  void import("./TerminalWindowApp.vue").then((m) => {
    mountRoot(m.default);
  });
} else {
  void import("./App.vue").then((m) => {
    mountRoot(m.default);
  });
}
