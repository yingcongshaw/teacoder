import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import AppLayout from "./components/layout/AppLayout";
import { useAppStore } from "./stores/appStore";
import "./index.css";

/**
 * 浏览器端左侧栏折叠测试台。
 *
 * 配合 sidebar-test.html 使用：渲染真实 AppLayout，用真实点击验证
 * 折叠按钮的位置（右侧区最左 50px）、折叠后槽位保留、图标翻转。
 */
declare global {
  interface Window {
    /** 读取折叠状态，供测试脚本断言 */
    __SIDEBAR_STATE__?: () => {
      collapsed: boolean;
      stored: string | null;
      buttonLeft: number;
      buttonWidth: number;
      label: string;
      sidebarPresent: boolean;
      slotLeft: number;
    };
  }
}

window.__SIDEBAR_STATE__ = () => {
  const btn = document.querySelector<HTMLElement>('button[aria-label*="侧边栏"]');
  const rect = btn?.getBoundingClientRect();
  // 折叠槽：按钮所在的 50px 容器
  const slot = btn?.parentElement?.getBoundingClientRect();
  // 真实侧边栏：宽度 240 的那一块
  const sidebar = Array.from(document.querySelectorAll<HTMLElement>("div")).find(
    (el) => Math.round(el.getBoundingClientRect().width) === 240 && el.getBoundingClientRect().height > 200,
  );
  return {
    collapsed: useAppStore.getState().sidebarCollapsed,
    stored: localStorage.getItem("teacoder_sidebar_collapsed"),
    buttonLeft: rect ? Math.round(rect.left) : -1,
    buttonWidth: rect ? Math.round(rect.width) : -1,
    label: btn?.getAttribute("aria-label") ?? "",
    sidebarPresent: Boolean(sidebar),
    slotLeft: slot ? Math.round(slot.left) : -1,
  };
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppLayout />
  </StrictMode>,
);
