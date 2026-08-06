import { useState } from "react";
import { Dropdown, Modal, Input, App } from "antd";
import type { MenuProps } from "antd";
import {
  FolderOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import { useAppStore } from "../../stores/appStore";
import { TOOL_DISPLAY_NAMES } from "../../types";
import type { Project, Session } from "../../types";

const TOOL_COLORS: Record<string, string> = {
  claude: "#722ed1",
  codex: "#1890ff",
  gemini: "#1677ff",
  opencode: "#fa8c16",
};

interface ProjectNodeProps {
  project: Project;
  sessions: Session[];
}

export default function ProjectNode({ project, sessions }: ProjectNodeProps) {
  const openTabIds = useAppStore((s) => s.openTabIds);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const openTab = useAppStore((s) => s.openTab);
  const deleteSession = useAppStore((s) => s.deleteSession);
  const deleteProject = useAppStore((s) => s.deleteProject);
  const updateProject = useAppStore((s) => s.updateProject);
  const setNewSessionModalOpen = useAppStore((s) => s.setNewSessionModalOpen);
  const collapsedProjectIds = useAppStore((s) => s.collapsedProjectIds);
  const toggleProjectCollapsed = useAppStore((s) => s.toggleProjectCollapsed);
  const { message } = App.useApp();

  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);

  const isCollapsed = collapsedProjectIds.includes(project.id);

  const handleRename = () => {
    setRenameValue(project.name);
    setRenaming(true);
  };

  const confirmRename = () => {
    if (renameValue.trim() && renameValue.trim() !== project.name) {
      updateProject(project.id, { name: renameValue.trim() });
      message.success("已重命名项目");
    }
    setRenaming(false);
  };

  const handleDelete = () => {
    const sessionCount = sessions.length;
    Modal.confirm({
      title: "删除项目",
      content: `确认删除项目「${project.name}」？${sessionCount > 0 ? `该项目下有 ${sessionCount} 个会话将一并删除。` : ""}此操作不可恢复。`,
      okText: "删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: () => deleteProject(project.id),
    });
  };

  const handleNewSession = () => {
    setNewSessionModalOpen(true, project.id);
  };

  const contextMenuItems: MenuProps["items"] = [
    {
      key: "newSession",
      label: "新建会话",
      icon: <PlusOutlined />,
      onClick: handleNewSession,
    },
    {
      key: "rename",
      label: "重命名",
      icon: <EditOutlined />,
      onClick: handleRename,
    },
    { type: "divider" },
    {
      key: "delete",
      label: "删除项目",
      icon: <DeleteOutlined />,
      danger: true,
      onClick: handleDelete,
    },
  ];

  const renderSessionItem = (session: Session) => {
    const isActive = session.id === activeTabId;
    const isOpen = openTabIds.includes(session.id);
    const isHovered = hoveredSessionId === session.id;
    const toolColor = TOOL_COLORS[session.toolType] || "#888";

    let textColor: string;
    let borderStyle: string;
    let bgColor: string | undefined;

    if (isActive) {
      textColor = "#e0e0e0";
      borderStyle = "2px solid #3b82f6";
      bgColor = "#2a2d38";
    } else if (isOpen) {
      textColor = "#cccccc";
      borderStyle = "2px solid rgba(59, 130, 246, 0.3)";
    } else {
      textColor = "#999999";
      borderStyle = "2px solid transparent";
    }

    return (
      <div
        key={session.id}
        onClick={() => {
          if (isOpen) {
            setActiveTab(session.id);
          } else {
            openTab(session.id);
          }
        }}
        onMouseEnter={() => setHoveredSessionId(session.id)}
        onMouseLeave={() => setHoveredSessionId(null)}
        className="w-full flex items-center px-3 py-1.5 text-xs cursor-pointer transition-colors"
        style={{
          color: textColor,
          borderLeft: borderStyle,
          backgroundColor: isHovered && !isActive ? "#252830" : bgColor,
        }}
      >
        <span
          className="inline-block w-1.5 h-1.5 rounded-full mr-2 flex-shrink-0"
          style={{ backgroundColor: session.color || toolColor }}
        />
        <span className="flex-1 truncate">
          {session.title || TOOL_DISPLAY_NAMES[session.toolType]}
        </span>
        {session.isRunning && (
          <span
            className="inline-block w-1.5 h-1.5 rounded-full bg-[#52c41a] mr-1 flex-shrink-0"
            style={{ animation: "pulse-dot 2s ease-in-out infinite" }}
          />
        )}
        {isHovered && !isActive && (
          <DeleteOutlined
            className="text-[10px] text-[#666666] hover:text-[#ff4d4f] ml-1 flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              Modal.confirm({
                title: "删除会话",
                content: "确认删除此会话记录？此操作不可恢复。",
                okText: "删除",
                cancelText: "取消",
                okButtonProps: { danger: true },
                onOk: () => deleteSession(session.id),
              });
            }}
          />
        )}
      </div>
    );
  };

  return (
    <div className="mb-0.5">
      <Dropdown menu={{ items: contextMenuItems }} trigger={["contextMenu"]}>
        <div
          className="flex items-center gap-1.5 px-3 py-1 text-[10px] text-[#666666] cursor-pointer hover:text-[#999999] transition-colors group"
          onClick={() => toggleProjectCollapsed(project.id)}
        >
          <FolderOutlined style={{ fontSize: 10, color: project.color || undefined }} />
          {renaming ? (
            <Input
              size="small"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onPressEnter={confirmRename}
              onBlur={confirmRename}
              className="flex-1"
              style={{ fontSize: 10 }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="truncate flex-1">{project.name}</span>
          )}
          <PlusOutlined
            className="opacity-0 group-hover:opacity-100 text-[9px] hover:text-[#3b82f6] transition-opacity flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              handleNewSession();
            }}
          />
          <span
            style={{
              fontSize: 9,
              transform: isCollapsed ? "rotate(-90deg)" : "none",
              transition: "transform 0.2s",
            }}
          >
            ▼
          </span>
        </div>
      </Dropdown>
      {!isCollapsed && sessions.map(renderSessionItem)}
    </div>
  );
}
