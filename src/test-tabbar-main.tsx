import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { ConfigProvider, App as AntdApp } from "antd";
import zhCN from "antd/locale/zh_CN";
import { useAppStore } from "./stores/appStore";
import type { Session } from "./types";
import TabBar from "./components/tabs/TabBar";
import "./index.css";

/**
 * 浏览器端 TabBar 拖拽测试台。
 *
 * 配合 tabbar-test.html 使用：注入两个 pane 与假会话，用 Playwright 做真实
 * HTML5 拖拽，验证插入落点与跨 pane 移动。dragover 阶段 dataTransfer 处于
 * 保护模式（getData 读不到内容），这类问题只有在真实浏览器里跑才暴露得出来。
 */

const mkSession = (id: string, title: string): Session => ({
  id,
  projectId: "proj1",
  title,
  toolType: "claude",
  thinkingIntensity: "medium",
  isRunning: false,
  createdAt: 0,
  updatedAt: 0,
  sortOrder: 0,
});

const sessions = [
  mkSession("s1", "Alpha"),
  mkSession("s2", "Bravo"),
  mkSession("s3", "Charlie"),
  mkSession("s4", "Delta"),
];

useAppStore.setState({
  sessions,
  projects: [],
  panes: [
    { id: "p1", openTabIds: ["s1", "s2", "s3"], activeTabId: "s1" },
    { id: "p2", openTabIds: ["s4"], activeTabId: "s4" },
  ],
  activePaneId: "p1",
  openTabIds: ["s1", "s2", "s3", "s4"],
  activeTabId: "s1",
  llmProviders: [],
});

declare global {
  interface Window {
    /** 读取各 pane 当前 tab 顺序，供测试脚本断言 */
    __PANE_TABS__?: () => string[][];
  }
}

window.__PANE_TABS__ = () => useAppStore.getState().panes.map((p) => p.openTabIds);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConfigProvider locale={zhCN}>
      <AntdApp>
        <div style={{ display: "flex", flexDirection: "row", height: "100vh" }}>
          <div id="pane1" style={{ width: "50%", overflow: "hidden" }}>
            <TabBar paneId="p1" />
          </div>
          <div id="pane2" style={{ width: "50%", overflow: "hidden" }}>
            <TabBar paneId="p2" />
          </div>
        </div>
      </AntdApp>
    </ConfigProvider>
  </StrictMode>,
);
