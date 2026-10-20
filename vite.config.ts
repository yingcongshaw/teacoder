import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// 测试模式：当通过 `pnpm dev:test` 或 VITE_TEST_MODE=1 启动时，把 @tauri-apps/api/* 重定向到本地 mock
// 这样可以在纯浏览器里跑 TerminalView 测试，验证复制/粘贴等逻辑。
const isTestMode =
  // @ts-expect-error process is a nodejs global
  process.env.VITE_TEST_MODE === "1" ||
  // @ts-expect-error process is a nodejs global
  process.argv.includes("--test");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  clearScreen: false,
  server: {
    port: 1421,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },

  resolve: isTestMode
    ? {
        alias: {
          "@tauri-apps/api/event": path.resolve(__dirname, "src/__mocks__/tauri-event.ts"),
          "@tauri-apps/api/core": path.resolve(__dirname, "src/__mocks__/tauri-core.ts"),
        },
      }
    : undefined,
}));