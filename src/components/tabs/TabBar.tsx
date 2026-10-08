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
} from "@ant-design/icons";
import { useAppStore } from "../../stores/appStore";
import { TOOL_DISPLAY_NAMES } from "../../types";
import type { Session } from "../../types";
import { openPathInFileManager, openTerminal } from "../../utils/ipc";

export default function TabBar() {
  const sessions = useAppStore((s) => s.sessions);
  const projects = useAppStore((s) => s.projects);
  const openTabIds = useAppStore((s) => s.openTabIds);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const deleteSession = useAppStore((s) => s.deleteSession);
  const updateSession = useAppStore((s) => s.updateSession);
  const duplicateSession = useAppStore((s) => s.duplicateSession);
  const closeOtherTabs = useAppStore((s) => s.closeOtherTabs);
  const closeAllTabs = useAppStore((s) => s.closeAllTabs);
  const locateSession = useAppStore((s) => s.locateSession);
  const llmProviders = useAppStore((s) => s.llmProviders);
  const { message, modal } = App.useApp();

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [propertiesTab, setPropertiesTab] = useState<Session | null>(null);
  const [movingTab, setMovingTab] = useState<Session | null>(null);
  const [moveTargetProjectId, setMoveTargetProjectId] = useState<string | null>(null);
  const renameInputRef = useRef<InputRef | null>(null);

  // 只显示已打开的标签
  const openTabs = openTabIds
    .map((id) => sessions.find((s) => s.id === id))
    .filter((s): s is Session => s !== undefined);

  useEffect(() => {
    if (renamingId) {
      setTimeout(() => renameInputRef.current?.focus(), 50);
    }
  }, [renamingId]);

  const handleClose = (tabId: string, isRunning: boolean) => {
    if (isRunning) {
      modal.confirm({
        title: "关闭标签",
        content: "关闭将终止 CLI 进程，会话记录将保留在左侧列表中。",
        okText: "关闭标签",
        cancelText: "取消",
        okButtonProps: { danger: true },
        onOk: () => closeTab(tabId),
      });
    } else {
      closeTab(tabId);
    }
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
        duplicateSession(tab.id);
        message.success("已复制会话");
      },
    },
    {
      key: "move",
      label: "移动到其他项目",
      icon: <SwapOutlined />,
      onClick: () => handleMoveToProject(tab),
    },
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
    {
      key: "properties",
      label: "查看属性",
      icon: <InfoCircleOutlined />,
      onClick: () => setPropertiesTab(tab),
    },
    { type: "divider" },
    {
      key: "locate",
      label: "定位到项目",
      icon: <AimOutlined />,
      onClick: () => locateSession(tab.id),
    },
    { type: "divider" },
    {
      key: "close",
      label: "关闭标签",
      icon: <CloseOutlined />,
      onClick: () => handleClose(tab.id, tab.isRunning),
    },
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
    { type: "divider" },
    {
      key: "delete",
      label: "删除会话",
      icon: <DeleteOutlined />,
      danger: true,
      onClick: () => handleDelete(tab),
    },
  ];

  return (
    <>
      <div
        className="flex items-center overflow-x-auto"
        style={{
          height: 32,
          backgroundColor: "var(--ant-color-bg-container)",
          borderBottom: "1px solid var(--ant-color-border-secondary)",
        }}
      >
        {openTabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <Dropdown
              key={tab.id}
              menu={{ items: buildContextMenu(tab) }}
              trigger={["contextMenu"]}
            >
              <div
                onClick={() => {
                  setActiveTab(tab.id);
                  locateSession(tab.id);
                }}
                onDoubleClick={() => handleRename(tab)}
                className="flex items-center gap-1 px-3 h-full cursor-pointer whitespace-nowrap text-xs"
                style={{
                  color: isActive ? "var(--ant-color-text)" : "var(--ant-color-text-secondary)",
                  borderRight: "1px solid var(--ant-color-border-secondary)",
                  backgroundColor: isActive ? "var(--ant-color-bg-layout)" : undefined,
                  borderBottom: isActive ? "4px solid var(--ant-color-primary)" : "4px solid transparent",
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
                  <span className="truncate max-w-[120px]">{tab.title || TOOL_DISPLAY_NAMES[tab.toolType]}</span>
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
                    handleClose(tab.id, tab.isRunning);
                  }}
                  className="ml-1 flex-shrink-0"
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--ant-color-text-quaternary)",
                    cursor: "pointer",
                    fontSize: 14,
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
