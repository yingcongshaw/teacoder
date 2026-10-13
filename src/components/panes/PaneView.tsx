import { useRef, useEffect } from "react";
import { Dropdown } from "antd";
import type { MenuProps } from "antd";
import {
  FolderOutlined,
  RightSquareOutlined,
  CopyOutlined,
  SnippetsOutlined,
} from "@ant-design/icons";
import { useAppStore } from "../../stores/appStore";
import TerminalView, { type TerminalViewHandle } from "../terminal/TerminalView";
import TabBar from "../tabs/TabBar";
import { openPathInFileManager, openTerminal } from "../../utils/ipc";

interface PaneViewProps {
  paneId: string;
  /** 是否全局活动面板:只有活动面板的 TerminalView 接收键盘输入(避免双开双写 PTY) */
  isActivePane: boolean;
  terminalRefs: React.MutableRefObject<Map<string, TerminalViewHandle>>;
  onCopy: (tabId: string) => void;
  onPaste: (tabId: string) => void;
}

/** 复合 ref key: 同 tabId 在多个 pane 并存时互不覆盖 */
const refKey = (paneId: string, tabId: string): string => `${paneId}:${tabId}`;

// macOS 主修饰键是 Cmd(metaKey),其他平台是 Ctrl(ctrlKey)
const IS_MAC = typeof navigator !== "undefined" &&
  (/Mac|iPhone|iPad|iPod/i.test(navigator.platform) ||
    /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent));

/**
 * 单个分屏面板：顶部 TabBar + 底部终端区域。
 * 终端区域：渲染面板内所有已打开 tab 的 TerminalView，visibility 切换 active tab，
 * 这样切换 tab 时 xterm 不会卸载重建，scrollback / IME 状态都保留。
 */
export default function PaneView({ paneId, isActivePane, terminalRefs, onCopy, onPaste }: PaneViewProps) {
  const sessions = useAppStore((s) => s.sessions);
  const projects = useAppStore((s) => s.projects);
  const pane = useAppStore((s) => s.panes.find((p) => p.id === paneId));
  const activeTabId = pane?.activeTabId ?? null;
  const openTabIds = pane?.openTabIds ?? [];
  const containerRef = useRef<HTMLDivElement | null>(null);

  // 容器 mousedown 时把焦点切到本面板（用于热键/状态条感知）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = () => {
      useAppStore.getState().setActivePane(paneId);
    };
    el.addEventListener("mousedown", handler);
    return () => el.removeEventListener("mousedown", handler);
  }, [paneId]);

  if (!pane) return null;

  if (openTabIds.length === 0) {
    return (
      <div
        ref={containerRef}
        className="flex flex-col h-full min-w-0 bg-[var(--ant-color-bg-container)]"
      >
        <TabBar paneId={paneId} />
        <div className="flex-1 flex items-center justify-center text-[var(--ant-color-text-tertiary)] text-sm">
          在标签上右键 → 选择「向左侧/右侧分屏」开始分屏
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-full min-w-0 bg-[var(--ant-color-bg-container)]"
    >
      <TabBar paneId={paneId} />
      <div className="flex-1 relative overflow-hidden min-h-0">
        {openTabIds.map((tabId, idx) => {
          const session = sessions.find((s) => s.id === tabId);
          if (!session) return null;
          const project = projects.find((p) => p.id === session.projectId);
          const projectPath = project?.path;
          const isActive = tabId === activeTabId;

          const contextMenu: MenuProps["items"] = [
            {
              key: "copy",
              label: (
                <span className="flex items-center justify-between gap-4">
                  <span>复制</span>
                  <span style={{ color: "var(--ant-color-text-tertiary)", fontSize: 11 }}>{IS_MAC ? "Cmd+Shift+C" : "Ctrl+Shift+C"}</span>
                </span>
              ),
              icon: <CopyOutlined />,
              onClick: () => onCopy(tabId),
            },
            {
              key: "paste",
              label: (
                <span className="flex items-center justify-between gap-4">
                  <span>粘贴</span>
                  <span style={{ color: "var(--ant-color-text-tertiary)", fontSize: 11 }}>{IS_MAC ? "Cmd+Shift+V" : "Ctrl+Shift+V"}</span>
                </span>
              ),
              icon: <SnippetsOutlined />,
              onClick: () => onPaste(tabId),
            },
            { type: "divider" as const },
            ...(projectPath
              ? [
                  {
                    key: "openInFileManager",
                    label: "打开文件浏览器",
                    icon: <FolderOutlined />,
                    onClick: () => openPathInFileManager(projectPath),
                  },
                  {
                    key: "openTerminal",
                    label: "打开外部终端",
                    icon: <RightSquareOutlined />,
                    onClick: () => openTerminal(projectPath),
                  },
                ]
              : []),
          ];

          return (
            <Dropdown
              key={`${paneId}:${tabId}#${idx}`}
              menu={{ items: contextMenu }}
              trigger={["contextMenu"]}
            >
              <div
                className="absolute inset-0"
                style={{
                  visibility: isActive ? "visible" : "hidden",
                  zIndex: isActive ? 1 : 0,
                }}
              >
                <TerminalView
                  tabId={tabId}
                  visible={isActive}
                  enableInput={isActivePane}
                  ref={(handle) => {
                    const k = refKey(paneId, tabId);
                    if (handle) terminalRefs.current.set(k, handle);
                    else terminalRefs.current.delete(k);
                  }}
                />
              </div>
            </Dropdown>
          );
        })}
      </div>
    </div>
  );
}
