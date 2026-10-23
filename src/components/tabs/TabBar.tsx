import { useState, useRef, useEffect } from "react";
import { Modal, Dropdown, Input, Select, App } from "antd";
import type { MenuProps, InputRef } from "antd";
import {
  FolderOutlined,
  RightSquareOutlined,
  AimOutlined,
  EditOutlined,
  CopyOutlined,
  SwapOutlined,
  InfoCircleOutlined,
  CloseOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  VerticalLeftOutlined,
  VerticalRightOutlined,
  CloseSquareOutlined,
} from "@ant-design/icons";
import { useAppStore } from "../../stores/appStore";
import { TOOL_DISPLAY_NAMES } from "../../types";
import type { Session } from "../../types";
import { openPathInFileManager, openTerminal } from "../../utils/ipc";

interface TabBarProps {
  /** 所属分屏面板 id；不传则退回全局视图（兼容旧用法） */
  paneId?: string;
}

// HTML5 DnD payload：跨面板拖拽 tab 使用。源 pane 存 dataTransfer，drop 端用 onDragOver 的目标
// tab 索引决定插入位置（空面板直接追加到末尾）。
const DND_MIME_TAB = "application/x-teacoder-tab";

interface DragPayload {
  tabId: string;
  sourcePaneId: string;
}

function readDragPayload(dt: DataTransfer): DragPayload | null {
  const raw = dt.getData(DND_MIME_TAB);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DragPayload;
    if (typeof parsed.tabId === "string" && typeof parsed.sourcePaneId === "string") {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

export default function TabBar({ paneId }: TabBarProps = {}) {
  const sessions = useAppStore((s) => s.sessions);
  const projects = useAppStore((s) => s.projects);
  const panes = useAppStore((s) => s.panes);
  const globalActivePaneId = useAppStore((s) => s.activePaneId);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setActivePane = useAppStore((s) => s.setActivePane);
  const closeTab = useAppStore((s) => s.closeTab);
  const deleteSession = useAppStore((s) => s.deleteSession);
  const updateSession = useAppStore((s) => s.updateSession);
  const duplicateSession = useAppStore((s) => s.duplicateSession);
  const closeOtherTabs = useAppStore((s) => s.closeOtherTabs);
  const closeAllTabs = useAppStore((s) => s.closeAllTabs);
  const locateSession = useAppStore((s) => s.locateSession);
  const splitPane = useAppStore((s) => s.splitPane);
  const closePane = useAppStore((s) => s.closePane);
  const moveTabToPane = useAppStore((s) => s.moveTabToPane);
  const reorderTabInPane = useAppStore((s) => s.reorderTabInPane);
  const llmProviders = useAppStore((s) => s.llmProviders);
  const { message, modal } = App.useApp();

  // 当前面板：若 paneId 传了就用指定面板，否则取全局活动面板，否则第一个
  const pane = paneId
    ? panes.find((p) => p.id === paneId)
    : (panes.find((p) => p.id === globalActivePaneId) ?? panes[0] ?? null);
  const openTabIds = pane?.openTabIds ?? [];
  const activeTabId = pane?.activeTabId ?? null;
  const canSplit = panes.length < 2;
  const canClosePane = panes.length > 1;

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [propertiesTab, setPropertiesTab] = useState<Session | null>(null);
  const [movingTab, setMovingTab] = useState<Session | null>(null);
  const [moveTargetProjectId, setMoveTargetProjectId] = useState<string | null>(null);
  const renameInputRef = useRef<InputRef | null>(null);

  // 只显示当前面板内已打开的标签
  const openTabs = openTabIds
    .map((id) => sessions.find((s) => s.id === id))
    .filter((s): s is Session => s !== undefined);

  useEffect(() => {
    if (renamingId) {
      setTimeout(() => renameInputRef.current?.focus(), 50);
    }
  }, [renamingId]);

  const handleClose = (tabId: string) => {
    // 直接关闭:不再弹确认框。共享 PTY 时由 store 内部按 instanceCount 决定是否 stopSession。
    closeTab(tabId, pane?.id);
  };

  const handleDelete = (tab: Session) => {
    modal.confirm({
      title: "删除会话",
      content: "确认删除此会话记录？此操作不可恢复。",
      okText: "删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: () => {
        deleteSession(tab.id);
        message.success("已删除会话");
      },
    });
  };

  const handleRename = (tab: Session) => {
    setRenamingId(tab.id);
    setRenameValue(tab.title || "");
  };

  const confirmRename = () => {
    if (renamingId) {
      updateSession(renamingId, { title: renameValue.trim() });
      setRenamingId(null);
    }
  };

  const handleMoveToProject = (tab: Session) => {
    setMovingTab(tab);
    setMoveTargetProjectId(tab.projectId);
  };

  const confirmMove = () => {
    if (movingTab && moveTargetProjectId) {
      updateSession(movingTab.id, { projectId: moveTargetProjectId });
      message.success("已移动到新项目");
    }
    setMovingTab(null);
  };

  const getProjectName = (projectId: string) =>
    projects.find((p) => p.id === projectId)?.name || "未知项目";

  const getProjectPath = (projectId: string) =>
    projects.find((p) => p.id === projectId)?.path;

  const buildContextMenu = (tab: Session): MenuProps["items"] => [
    {
      key: "properties",
      label: "查看属性",
      icon: <InfoCircleOutlined />,
      onClick: () => setPropertiesTab(tab),
    },
    {
      key: "rename",
      label: "重命名",
      icon: <EditOutlined />,
      onClick: () => handleRename(tab),
    },
    {
      key: "duplicate",
      label: "复制会话",
      icon: <CopyOutlined />,
      onClick: () => {
        duplicateSession(tab.id)
          .then((created) => {
            if (created) message.success(`已复制会话「${created.title}」`);
          })
          .catch(() => message.error("复制会话失败"));
      },
    },
    {
      key: "delete",
      label: "删除会话",
      icon: <DeleteOutlined />,
      danger: true,
      onClick: () => handleDelete(tab),
    },
    { type: "divider" },
    {
      key: "move",
      label: "移动到其他项目",
      icon: <SwapOutlined />,
      onClick: () => handleMoveToProject(tab),
    },
    {
      key: "locate",
      label: "定位到项目",
      icon: <AimOutlined />,
      onClick: () => locateSession(tab.id),
    },
    { type: "divider" },
    {
      key: "splitLeft",
      label: canSplit ? "向左侧分屏" : "向左侧分屏（已达 2 面板上限）",
      icon: <VerticalLeftOutlined />,
      disabled: !canSplit,
      onClick: () => splitPane(tab.id, "left"),
    },
    {
      key: "splitRight",
      label: canSplit ? "向右侧分屏" : "向右侧分屏（已达 2 面板上限）",
      icon: <VerticalRightOutlined />,
      disabled: !canSplit,
      onClick: () => splitPane(tab.id, "right"),
    },
    {
      key: "closePane",
      label: "关闭分屏",
      icon: <CloseSquareOutlined />,
      disabled: !canClosePane,
      onClick: () => {
        if (pane) closePane(pane.id);
      },
    },
    { type: "divider" },
    {
      key: "openInFileManager",
      label: "打开文件浏览器",
      icon: <FolderOutlined />,
      onClick: () => {
        const projectPath = getProjectPath(tab.projectId);
        if (projectPath) {
          openPathInFileManager(projectPath);
        }
      },
    },
    {
      key: "openTerminal",
      label: "打开终端",
      icon: <RightSquareOutlined />,
      onClick: () => {
        const projectPath = getProjectPath(tab.projectId);
        if (projectPath) {
          openTerminal(projectPath);
        }
      },
    },
    { type: "divider" },
    {
      key: "closeOthers",
      label: "关闭其他标签",
      icon: <CloseCircleOutlined />,
      onClick: () => closeOtherTabs(tab.id),
    },
    {
      key: "closeAll",
      label: "关闭所有标签",
      icon: <CloseOutlined />,
      onClick: () => closeAllTabs(),
    },
    {
      key: "close",
      label: "关闭标签",
      icon: <CloseOutlined />,
      onClick: () => handleClose(tab.id),
    },
  ];

  return (
    <>
      <div
        className="flex flex-wrap items-center"
        style={{
          minHeight: 32,
          backgroundColor: "var(--ant-color-bg-container)",
          borderBottom: "1px solid var(--ant-color-border-secondary)",
        }}
        onDragOver={(e) => {
          if (!pane) return;
          const payload = readDragPayload(e.dataTransfer);
          if (!payload) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = payload.sourcePaneId === pane.id ? "move" : "move";
        }}
        onDrop={(e) => {
          if (!pane) return;
          const payload = readDragPayload(e.dataTransfer);
          if (!payload) return;
          e.preventDefault();
          // 在空 tab strip 上 drop：直接追加到末尾
          if (openTabIds.length === 0) {
            if (payload.sourcePaneId !== pane.id) {
              moveTabToPane(payload.tabId, pane.id);
            } else {
              reorderTabInPane(pane.id, pane.openTabIds.indexOf(payload.tabId), 0);
            }
          }
          // 非空时由具体 tab 的 onDropHandler 决定插入位置（光标所在 tab 的左侧/右侧）
        }}
      >
        {openTabs.map((tab, index) => {
          const isActive = tab.id === activeTabId;
          return (
            <Dropdown
              key={tab.id}
              menu={{ items: buildContextMenu(tab) }}
              trigger={["contextMenu"]}
            >
              <div
                draggable
                onDragStart={(e) => {
                  if (!pane) return;
                  e.dataTransfer.effectAllowed = "move";
                  // dragstart 里直接放 dataTransfer，drop 端才能读到
                  e.dataTransfer.setData(
                    DND_MIME_TAB,
                    JSON.stringify({ tabId: tab.id, sourcePaneId: pane.id } satisfies DragPayload),
                  );
                  // 部分浏览器需要 text/plain 才允许 drop
                  e.dataTransfer.setData("text/plain", tab.id);
                }}
                onDragOver={(e) => {
                  if (!pane) return;
                  const payload = readDragPayload(e.dataTransfer);
                  if (!payload) return;
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={(e) => {
                  if (!pane) return;
                  const payload = readDragPayload(e.dataTransfer);
                  if (!payload) return;
                  e.preventDefault();
                  e.stopPropagation();
                  // 根据光标 X 落在 tab 左半 / 右半决定插入到该 tab 左侧还是右侧
                  const rect = e.currentTarget.getBoundingClientRect();
                  const insertAfter = e.clientX > rect.left + rect.width / 2;
                  let insertIndex = insertAfter ? index + 1 : index;
                  if (payload.sourcePaneId === pane.id) {
                    const fromIdx = pane.openTabIds.indexOf(payload.tabId);
                    if (fromIdx < 0) return;
                    if (insertIndex > fromIdx) insertIndex -= 1;
                    if (fromIdx === insertIndex) return;
                    reorderTabInPane(pane.id, fromIdx, insertIndex);
                  } else {
                    moveTabToPane(payload.tabId, pane.id, insertIndex);
                  }
                }}
                onClick={() => {
                  if (pane) setActivePane(pane.id);
                  setActiveTab(tab.id);
                  locateSession(tab.id);
                }}
                onDoubleClick={() => handleRename(tab)}
                className="flex items-center gap-1 px-3 h-8 cursor-pointer whitespace-nowrap text-xs"
                style={{
                  boxSizing: "border-box",
                  color: isActive ? "var(--ant-color-text)" : "var(--ant-color-text-inactive)",
                  borderRight: "1px solid var(--ant-color-border-secondary)",
                  backgroundColor: isActive ? "var(--ant-color-bg-layout)" : undefined,
                  // 激活/未激活同宽，未激活用 transparent 占位，切换时下边框不会顶动内容
                  borderBottom: isActive ? "2px solid var(--ant-color-primary)" : "2px solid transparent",
                  transition: "background-color 0.15s",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.backgroundColor = "var(--ant-color-bg-elevated)";
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.backgroundColor = "";
                }}
              >
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: tab.color || "#888" }}
                />
                {renamingId === tab.id ? (
                  <Input
                    ref={renameInputRef}
                    size="small"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onPressEnter={confirmRename}
                    onBlur={confirmRename}
                    className="w-32"
                    style={{ fontSize: 12 }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className={`truncate max-w-[120px] ${isActive ? "font-semibold" : ""}`}>
                    {tab.title || TOOL_DISPLAY_NAMES[tab.toolType]}
                  </span>
                )}
                {(() => {
                  const provider = llmProviders.find((p) => p.id === tab.llmProviderId);
                  if (!provider) return null;
                  const bg = provider.color || "var(--ant-color-primary)";
                  const ch = provider.name.charAt(0).toUpperCase();
                  return (
                    <span
                      title={provider.name}
                      className="inline-flex items-center justify-center rounded flex-shrink-0"
                      style={{
                        width: 15,
                        height: 15,
                        backgroundColor: bg,
                        color: "#fff",
                        fontSize: 9,
                        lineHeight: 1,
                        fontWeight: 600,
                        marginLeft: 2,
                      }}
                    >
                      {ch}
                    </span>
                  );
                })()}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClose(tab.id);
                  }}
                  className="ml-1 flex-shrink-0"
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--ant-color-text-quaternary)",
                    cursor: "pointer",
                    fontSize: 16,
                    lineHeight: 1,
                    padding: "0 2px",
                    borderRadius: 2,
                    transition: "color 0.15s, background-color 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "var(--ant-color-text)";
                    e.currentTarget.style.backgroundColor = "var(--ant-color-bg-elevated)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "var(--ant-color-text-quaternary)";
                    e.currentTarget.style.backgroundColor = "transparent";
                  }}
                >
                  ×
                </button>
              </div>
            </Dropdown>
          );
        })}
      </div>

      <Modal
        title="会话属性"
        open={propertiesTab !== null}
        onCancel={() => setPropertiesTab(null)}
        footer={null}
        width={460}
      >
        {propertiesTab && (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-[var(--ant-color-text-secondary)]">标题</span>
              <span>{propertiesTab.title || "(未命名)"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--ant-color-text-secondary)]">工具</span>
              <span>{TOOL_DISPLAY_NAMES[propertiesTab.toolType]}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--ant-color-text-secondary)]">项目</span>
              <span>{getProjectName(propertiesTab.projectId)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--ant-color-text-secondary)]">Profile ID</span>
              <span className="text-xs">{propertiesTab.profileId || "(无)"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--ant-color-text-secondary)]">思考强度</span>
              <span>{propertiesTab.thinkingIntensity}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--ant-color-text-secondary)]">状态</span>
              <span style={{ color: propertiesTab.isRunning ? "var(--ant-color-success)" : "var(--ant-color-text-tertiary)" }}>
                {propertiesTab.isRunning ? "运行中" : "已停止"}
              </span>
            </div>
            {propertiesTab.envVars && (
              <div>
                <span className="text-[var(--ant-color-text-secondary)]">环境变量</span>
                <pre className="mt-1 p-2 bg-gray-50 dark:bg-gray-800 rounded text-xs whitespace-pre-wrap">
                  {propertiesTab.envVars}
                </pre>
              </div>
            )}
            {propertiesTab.cliArgs && (
              <div>
                <span className="text-[var(--ant-color-text-secondary)]">启动参数</span>
                <pre className="mt-1 p-2 bg-gray-50 dark:bg-gray-800 rounded text-xs whitespace-pre-wrap">
                  {propertiesTab.cliArgs}
                </pre>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        title="移动到其他项目"
        open={movingTab !== null}
        onOk={confirmMove}
        onCancel={() => setMovingTab(null)}
        okText="移动"
        cancelText="取消"
      >
        <div className="space-y-2">
          <p className="text-sm text-[var(--ant-color-text-secondary)]">
            选择目标项目，会话将移动到该项目下。
          </p>
          <Select
            value={moveTargetProjectId || undefined}
            onChange={setMoveTargetProjectId}
            style={{ width: "100%" }}
            placeholder="选择项目"
          >
            {projects
              .filter((p) => p.id !== movingTab?.projectId)
              .map((p) => (
                <Select.Option key={p.id} value={p.id}>
                  {p.name}
                </Select.Option>
              ))}
          </Select>
          <p className="text-xs text-[var(--ant-color-text-tertiary)]">
            注意：此操作仅改变会话的项目分组，不会重新启动 CLI 进程。
          </p>
        </div>
      </Modal>
    </>
  );
}
