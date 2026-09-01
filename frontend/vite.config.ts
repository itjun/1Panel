import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import wails from "@wailsio/runtime/plugins/vite";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { ElementPlusResolver } from "unplugin-vue-components/resolvers";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: Number(process.env.WAILS_VITE_PORT) || 9245,
    strictPort: true,
  },
  plugins: [
    vue(),
    wails("./bindings"),
    AutoImport({
      resolvers: [ElementPlusResolver()],
      dts: "src/auto-imports.d.ts",
    }),
    Components({
      resolvers: [ElementPlusResolver({ importStyle: "css" })],
      dts: "src/components.d.ts",
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // element-plus / echarts 单库压缩后仍约 570KB+，拆包后主入口已 <300KB；阈值略抬到 vendor 实况
    chunkSizeWarningLimit: 600,
    // 桌面端整包本地加载，但仍拆大 vendor，避免单 chunk 过大并利于缓存
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return;
          }
          if (id.includes("element-plus") || id.includes("@element-plus")) {
            return "element-plus";
          }
          if (id.includes("echarts")) {
            return "echarts";
          }
          if (id.includes("@xterm") || id.includes("/xterm/")) {
            return "xterm";
          }
          if (
            id.includes("/vue/") ||
            id.includes("vue-router") ||
            id.includes("/pinia/") ||
            id.includes("@vue/")
          ) {
            return "vue-vendor";
          }
          return "vendor";
        },
      },
    },
  },
});
