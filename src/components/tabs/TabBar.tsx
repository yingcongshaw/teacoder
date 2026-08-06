import { useState, useRef, useEffect } from "react";
import { Modal, Dropdown, Input, App } from "antd";
import type { MenuProps, InputRef } from "antd";
import { useAppStore } from "../../stores/appStore";
import { TOOL_DISPLAY_NAMES } from "../../types";
import type { TabState } from "../../types";

export default function TabBar() {
  const sessions = useAppStore((s) => s.sessions);
  const openTabIds = useAppStore((s) => s.openTabIds);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const deleteSession = useAppStore((s) => s.deleteSession);
  const updateSession = useAppStore((s) => s.updateSession);
  const duplicateSession = useAppStore((s) => s.duplicateSession);
  const closeOtherTabs = useAppStore((s) => s.closeOtherTabs);
  const closeTabsToRight = useAppStore((s) => s.closeTabsToRight);
  const { message } = App.useApp();

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [propertiesTab, setPropertiesTab] = useState<TabState | null>(null);
  const [movingTab, setMovingTab] = useState<TabState | null>(null);
  const [moveTargetDir, setMoveTargetDir] = useState("");
  const renameInputRef = useRef<InputRef | null>(null);

  // 只显示已打开的标签
  const openTabs = openTabIds
    .map((id) => sessions.find((s) => s.id === id))
    .filter((s): s is TabState => s !== undefined);

  useEffect(() => {
    if (renamingId) {
      setTimeout(() => renameInputRef.current?.focus(), 50);
    }
  }, [renamingId]);

  const handleClose = (tabId: string, isRunning: boolean) => {
    if (isRunning) {
      Modal.confirm({
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

  const handleDelete = (tab: TabState) => {
    Modal.confirm({
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

  const handleRename = (tab: TabState) => {
    setRenamingId(tab.id);
    setRenameValue(tab.title || "");
  };

  const confirmRename = () => {
    if (renamingId) {
      updateSession(renamingId, { title: renameValue.trim() });
      setRenamingId(null);
    }
  };

  const handleMoveToProject = (tab: TabState) => {
    setMovingTab(tab);
    setMoveTargetDir(tab.workDir);
  };

  const confirmMove = () => {
    if (movingTab && moveTargetDir.trim()) {
      updateSession(movingTab.id, { workDir: moveTargetDir.trim() });
      message.success("已移动到新项目");
    }
    setMovingTab(null);
  };

  const buildContextMenu = (tab: TabState): MenuProps["items"] => [
    {
      key: "rename",
      label: "重命名",
      onClick: () => handleRename(tab),
    },
    {
      key: "duplicate",
      label: "复制会话",
      onClick: () => {
        duplicateSession(tab.id);
        message.success("已复制会话");
      },
    },
    {
      key: "move",
      label: "移动到其他项目",
      onClick: () => handleMoveToProject(tab),
    },
    {
      key: "properties",
      label: "查看属性",
      onClick: () => setPropertiesTab(tab),
    },
    { type: "divider" },
    {
      key: "close",
      label: "关闭标签",
      onClick: () => handleClose(tab.id, tab.isRunning),
    },
    {
      key: "closeOthers",
      label: "关闭其他标签",
      onClick: () => closeOtherTabs(tab.id),
    },
    {
      key: "closeRight",
      label: "关闭右侧标签",
      onClick: () => closeTabsToRight(tab.id),
    },
    { type: "divider" },
    {
      key: "delete",
      label: "删除会话",
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
          backgroundColor: "#1e2229",
          borderBottom: "1px solid #2a2d38",
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
                onClick={() => setActiveTab(tab.id)}
                onDoubleClick={() => handleRename(tab)}
                className="flex items-center gap-1 px-3 h-full cursor-pointer whitespace-nowrap"
                style={{
                  fontSize: 12,
                  color: isActive ? "#e0e0e0" : "#cccccc",
                  borderRight: "1px solid #2a2d38",
                  backgroundColor: isActive ? "#0a0a0a" : undefined,
                  borderBottom: isActive ? "2px solid #3b82f6" : "2px solid transparent",
                  transition: "background-color 0.15s",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.backgroundColor = "#252830";
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.backgroundColor = "";
                }}
              >
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: tab.color || "#888" }}
                />
                {tab.isRunning && (
                  <span className="inline-block w-1 h-1 rounded-full bg-[#52c41a] flex-shrink-0" style={{ animation: "pulse-dot 2s ease-in-out infinite" }} />
                )}
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
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClose(tab.id, tab.isRunning);
                  }}
                  className="ml-1 flex-shrink-0"
                  style={{
                    background: "none",
                    border: "none",
                    color: "#666666",
                    cursor: "pointer",
                    fontSize: 14,
                    lineHeight: 1,
                    padding: "0 2px",
                    borderRadius: 2,
                    transition: "color 0.15s, background-color 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "#e0e0e0";
                    e.currentTarget.style.backgroundColor = "#3a3d48";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "#666666";
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
              <span className="text-gray-500">标题</span>
              <span>{propertiesTab.title || "(未命名)"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">工具</span>
              <span>{TOOL_DISPLAY_NAMES[propertiesTab.toolType]}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">工作目录</span>
              <span className="truncate ml-4 max-w-[300px]">{propertiesTab.workDir}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Profile ID</span>
              <span className="text-xs">{propertiesTab.profileId || "(无)"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">状态</span>
              <span style={{ color: propertiesTab.isRunning ? "#52c41a" : "#888888" }}>
                {propertiesTab.isRunning ? "运行中" : "已停止"}
              </span>
            </div>
            {propertiesTab.envVars && (
              <div>
                <span className="text-gray-500">环境变量</span>
                <pre className="mt-1 p-2 bg-gray-50 dark:bg-gray-800 rounded text-xs whitespace-pre-wrap">
                  {propertiesTab.envVars}
                </pre>
              </div>
            )}
            {propertiesTab.args && (
              <div>
                <span className="text-gray-500">启动参数</span>
                <pre className="mt-1 p-2 bg-gray-50 dark:bg-gray-800 rounded text-xs whitespace-pre-wrap">
                  {propertiesTab.args}
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
          <p className="text-sm text-gray-500">
            输入新的工作目录路径，会话将归类到该项目下。
          </p>
          <Input
            value={moveTargetDir}
            onChange={(e) => setMoveTargetDir(e.target.value)}
            placeholder="~/projects/other-app"
          />
          <p className="text-xs text-gray-400">
            注意：此操作仅改变会话的项目分组，不会重新启动 CLI 进程。
          </p>
        </div>
      </Modal>
    </>
  );
}
