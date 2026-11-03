# Tab 拖拽与侧边栏折叠 —— 浏览器测试台

Tauri 在 Linux 用 WebKitGTK、macOS 用 WKWebView、Windows 用 WebView2。三个引擎的
HTML5 拖拽行为并不一致，Chromium 上跑通的拖拽在 WebKit 上可能完全不派发 `drop`。
仓库里的两个测试台用于在真实引擎里复现和回归这些差异。

## 测试台

| 入口 | 渲染内容 | 暴露的探针 |
| --- | --- | --- |
| `/tabbar-test.html` | 两个 pane + 4 个假 session 的真实 `TabBar` | `window.__PANE_TABS__()` 返回各 pane 的 tab 顺序 |
| `/sidebar-test.html` | 真实 `AppLayout` | `window.__SIDEBAR_STATE__()` 返回折叠状态、按钮位置、localStorage |

启动开发服务器后直接访问：

```bash
pnpm dev
# http://localhost:1421/tabbar-test.html
# http://localhost:1421/sidebar-test.html
```

两个页面都不参与生产构建（`vite build` 只打包 `index.html`）。

## 已知引擎差异

### dragover 期间读不到 payload

`dragover` / `dragenter` 期间浏览器处于保护模式，`dataTransfer.getData()` 一律返回空字符串，
只有 `dataTransfer.types` 可读。因此判断"这是一次 tab 拖拽"必须走 `types`，
不能靠 `getData`，否则 `preventDefault()` 不执行，浏览器随之不触发 `drop`。

### WebKit 需要 dragenter 也被取消

WebKit 只有在 `dragenter` 被 `preventDefault()` 时才把该元素登记为 drop 目标。
只取消 `dragover` 时，`dragover` 会照常触发，但 `drop` 永远不会派发 —— 表现就是
"拖得动，松手后顺序不变"。`TabBar.tsx` 的 tab 元素和 Tab 栏容器因此都同时挂了
`onDragEnter` 与 `onDragOver`。

## 在真实引擎里做回归

Chromium（Playwright）：

```js
await page.dragAndDrop('[data-tab-id="s3"]', '[data-tab-id="s1"]', {
  targetPosition: { x: 5, y: 14 },
});
```

WebKitGTK 无法用 Playwright 启动（缺 `libavif16`），改用 XTEST 注入真实 X11 输入事件：

```python
XTST.XTestFakeMotionEvent(xdisplay, screen, x, y, 0)
X11.XFlush(xdisplay)          # 必须逐条 flush，否则事件成批到达，拖拽会话来不及建立
XTST.XTestFakeButtonEvent(xdisplay, 1, True, 0)
```

注意 GTK 需要 session bus，进程要跑在 `dbus-run-session` 下；无窗口管理器时
Tauri 窗口不会撑到配置尺寸，需要 `XResizeWindow` 强制设置。
