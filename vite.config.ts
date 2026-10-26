import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
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

const HELP_IMAGE_DIMS_ID = "virtual:help-image-dims";
const RESOLVED_HELP_IMAGE_DIMS_ID = `\0${HELP_IMAGE_DIMS_ID}`;

/** PNG 的宽高在 IHDR 块里：签名 8 字节 + 块头 8 字节，之后是大端的宽高各 4 字节 */
function pngSize(data: Uint8Array): [number, number] | null {
  if (data.length < 24) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0) !== 0x89504e47) return null;
  return [view.getUint32(16), view.getUint32(20)];
}

/** JPEG 的宽高在 SOFn 段里，只能逐段跳过 marker 去找 */
function jpegSize(data: Uint8Array): [number, number] | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 2;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = data[offset + 1];
    // SOF0~SOF15 段里存着宽高，但要排除 DHT/JPG/DAC 这三个同段的标记
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return [view.getUint16(offset + 7), view.getUint16(offset + 5)];
    }
    offset += 2 + view.getUint16(offset + 2);
  }
  return null;
}

/**
 * 构建期量出 README 引用到的本地图片尺寸，交给帮助窗口预留位置。
 *
 * 截图不预占位置时，懒加载会把文档一路撑高，Chromium 随之把弹窗滚到中段，
 * 打开帮助看到的是文档中间而不是开头。
 */
function helpImageDims(root: string): Plugin {
  const readmeFile = path.resolve(root, "README.md");
  const publicDir = path.resolve(root, "public");

  const collect = (): Record<string, [number, number]> => {
    const dims: Record<string, [number, number]> = {};
    let readme: string;
    try {
      readme = fs.readFileSync(readmeFile, "utf8");
    } catch {
      return dims;
    }
    const refs = new Set<string>();
    for (const m of readme.matchAll(/!\[[^\]]*\]\(\s*([^)\s]+)/g)) refs.add(m[1]);
    for (const m of readme.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)) refs.add(m[1]);
    for (const ref of refs) {
      // public 会被打包到站点根，README 里的 public/xxx 对应应用内的 /xxx
      const appPath = ref.startsWith("/")
        ? ref
        : ref.replace(/^\.\//, "").replace(/^public\//, "/");
      if (!appPath.startsWith("/")) continue;
      const file = path.resolve(publicDir, `.${appPath}`);
      // README 里的路径不能指到 public 之外
      if (!file.startsWith(publicDir + path.sep)) continue;
      let size: [number, number] | null = null;
      try {
        const data = fs.readFileSync(file);
        size = pngSize(data) ?? jpegSize(data);
      } catch {
        continue;
      }
      if (size) dims[appPath] = size;
    }
    return dims;
  };

  return {
    name: "help-image-dims",
    resolveId: (id) => (id === HELP_IMAGE_DIMS_ID ? RESOLVED_HELP_IMAGE_DIMS_ID : null),
    load: (id) =>
      id === RESOLVED_HELP_IMAGE_DIMS_ID ? `export default ${JSON.stringify(collect())};` : null,
    handleHotUpdate(ctx) {
      if (ctx.file !== readmeFile && !ctx.file.startsWith(publicDir + path.sep)) return;
      const mod = ctx.server.moduleGraph.getModuleById(RESOLVED_HELP_IMAGE_DIMS_ID);
      if (mod) ctx.server.reloadModule(mod);
    },
  };
}

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss(), helpImageDims(__dirname)],

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