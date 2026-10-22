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

  build: {
    // vendor-antd 含 antd + rc-*，两者双向引用无法再拆；且 Tauri 走本地文件加载，不涉及网络传输。
    // 阈值取 1000 只豁免这类第三方库块，业务代码块仍受 500 kB 约束。
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // antd 及其 rc-* 子依赖体量大且极少变动，单独成块让浏览器长期缓存；
        // xterm 与 Tauri 桥接同理。拆分只影响缓存命中率，不改变运行时行为。
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("@xterm/") || id.includes("/xterm/")) return "vendor-xterm";
          if (id.includes("@tauri-apps/")) return "vendor-tauri";
          // rc-* 底层库与 antd 存在双向引用，拆开会产生循环 chunk 引用（ESM 下有 TDZ 风险），故合并成块
          if (
            id.includes("@ant-design/") ||
            id.includes("/antd/") ||
            id.includes("@rc-component/") ||
            /\/rc-[\w-]+\//.test(id)
          ) {
            return "vendor-antd";
          }
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/scheduler/")
          ) {
            return "vendor-react";
          }
          return "vendor-misc";
        },
      },
    },
  },
}));