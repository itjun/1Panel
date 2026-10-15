import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import wails from "@wailsio/runtime/plugins/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: Number(process.env.WAILS_VITE_PORT) || 9245,
    strictPort: true,
    // 本地验证独立看板时复用正在运行的只读网关；生产仍走同源 /api/board。
    proxy: process.env.BOARD_API_ORIGIN
      ? { "/api/board": { target: process.env.BOARD_API_ORIGIN, changeOrigin: true } }
      : undefined,
  },
  plugins: [tailwindcss(), react({ include: /\.(jsx|tsx)$/ }), wails("./bindings")],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return;
          }
          if (id.includes("echarts")) {
            return "echarts";
          }
          if (id.includes("@codemirror") || id.includes("/codemirror/")) {
            return "codemirror";
          }
          return "vendor";
        },
      },
    },
  },
});
