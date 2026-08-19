import { useState } from "react";
import { Dropdown, Modal, Input, App } from "antd";
import type { MenuProps } from "antd";
import {
  FolderOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
  FireOutlined,
  DesktopOutlined,
  CloudOutlined,
  FolderOpenOutlined,
} from "@ant-design/icons";
import { useAppStore } from "../../stores/appStore";
import { TOOL_DISPLAY_NAMES } from "../../types";
import type { Project, Session, ToolType, SessionCategory } from "../../types";

const TOOL_COLORS: Record<string, string> = {
  claude: "#722ed1",
  codex: "#1890ff",
  gemini: "#1677ff",
  opencode: "#fa8c16",
  terminal: "#52c41a",
  ssh: "#1677ff",
};

const TOOL_ICONS: Record<ToolType, React.ReactNode> = {
  claude: null,
  codex: null,
  gemini: null,
  antigravity: null,
  opencode: null,
  terminal: <DesktopOutlined style={{ fontSize: 12 }} />,
  ssh: <CloudOutlined style={{ fontSize: 12 }} />,
};

interface ProjectNodeProps {
  project: Project;
  sessions: Session[];
  categories: SessionCategory[];
}

export default function ProjectNode({ project, sessions, categories }: ProjectNodeProps) {
  const openTabIds = useAppStore((s) => s.openTabIds);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const openTab = useAppStore((s) => s.openTab);
  const deleteSession = useAppStore((s) => s.deleteSession);
  const updateSession = useAppStore((s) => s.updateSession);
  const deleteProject = useAppStore((s) => s.deleteProject);
  const updateProject = useAppStore((s) => s.updateProject);
  const setNewSessionModalOpen = useAppStore((s) => s.setNewSessionModalOpen);
  const collapsedProjectIds = useAppStore((s) => s.collapsedProjectIds);
  const toggleProjectCollapsed = useAppStore((s) => s.toggleProjectCollapsed);
  const collapsedCategoryIds = useAppStore((s) => s.collapsedCategoryIds);
  const toggleCategoryCollapsed = useAppStore((s) => s.toggleCategoryCollapsed);
  const createCategory = useAppStore((s) => s.createCategory);
  const updateCategory = useAppStore((s) => s.updateCategory);
  const deleteCategory = useAppStore((s) => s.deleteCategory);
  const { message } = App.useApp();

  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renamingSessionValue, setRenamingSessionValue] = useState("");
  const [renamingCategoryId, setRenamingCategoryId] = useState<string | null>(null);
  const [renamingCategoryValue, setRenamingCategoryValue] = useState("");

  const isCollapsed = collapsedProjectIds.includes(project.id);

  const projectCategories = categories.filter((c) => c.projectId === project.id);
  const uncategorizedSessions = sessions.filter(
    (s) => s.projectId === project.id && !s.categoryId,
  );

  // 拖拽状态
  const [draggingSessionId, setDraggingSessionId] = useState<string | null>(null);

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

  const handleNewCategory = () => {
    setNewCategoryName("");
    Modal.confirm({
      title: "新建分类",
      content: (
        <Input
          placeholder="输入分类名称"
          value={newCategoryName}
          onChange={(e) => setNewCategoryName(e.target.value)}
          autoFocus
        />
      ),
      okText: "创建",
      cancelText: "取消",
      onOk: async () => {
        if (newCategoryName.trim()) {
          await createCategory({ projectId: project.id, name: newCategoryName.trim() });
          message.success("已创建分类");
        }
        setNewCategoryName("");
      },
    });
  };

  const handleRenameCategory = (category: SessionCategory) => {
    setRenamingCategoryId(category.id);
    setRenamingCategoryValue(category.name);
  };

  const confirmRenameCategory = () => {
    if (renamingCategoryId) {
      const trimmed = renamingCategoryValue.trim();
      const category = projectCategories.find((c) => c.id === renamingCategoryId);
      if (trimmed && trimmed !== category?.name) {
        updateCategory(renamingCategoryId, { name: trimmed });
        message.success("已重命名分类");
      }
      setRenamingCategoryId(null);
    }
  };

  const handleDeleteCategory = (category: SessionCategory) => {
    Modal.confirm({
      title: "删除分类",
      content: `确认删除分类「${category.name}」？该分类下的会话将移至项目根目录。`,
      okText: "删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: () => deleteCategory(category.id),
    });
  };

  // 拖拽会话到分类
  const handleDragStart = (e: React.DragEvent, sessionId: string) => {
    setDraggingSessionId(sessionId);
    e.dataTransfer.setData("sessionId", sessionId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragEnd = () => {
    setDraggingSessionId(null);
  };

  const handleDragOver = (e: React.DragEvent, _categoryId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDragOverProject = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = async (e: React.DragEvent, categoryId: string) => {
    e.preventDefault();
    const sessionId = e.dataTransfer.getData("sessionId");
    if (sessionId) {
      // 更新会话的分类
      await updateSession(sessionId, { categoryId });
      message.success("已将会话移至分类");
    }
    setDraggingSessionId(null);
  };

  // 拖拽到项目根目录，取消分类
  const handleDropToProject = async (e: React.DragEvent) => {
    e.preventDefault();
    const sessionId = e.dataTransfer.getData("sessionId");
    if (sessionId) {
      // 取消分类，设置 categoryId 为空字符串
      await updateSession(sessionId, { categoryId: "" });
      message.success("已将会话移至项目根目录");
    }
    setDraggingSessionId(null);
  };

  const handleRenameSession = (session: Session) => {
    setRenamingSessionId(session.id);
    setRenamingSessionValue(session.title || "");
  };

  const confirmRenameSession = () => {
    if (renamingSessionId) {
      const trimmed = renamingSessionValue.trim();
      const session = sessions.find((s) => s.id === renamingSessionId);
      if (trimmed !== session?.title) {
        updateSession(renamingSessionId, { title: trimmed || undefined });
        message.success("已重命名会话");
      }
      setRenamingSessionId(null);
    }
  };

  const contextMenuItems: MenuProps["items"] = [
    {
      key: "newSession",
      label: "新建会话",
      icon: <PlusOutlined />,
      onClick: handleNewSession,
    },
    {
      key: "newCategory",
      label: "新建分类",
      icon: <FolderOpenOutlined />,
      onClick: handleNewCategory,
    },
    { type: "divider" },
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

  const getCategoryContextMenu = (category: SessionCategory): MenuProps["items"] => [
    {
      key: "newSession",
      label: "新建会话",
      icon: <PlusOutlined />,
      onClick: () => {
        setNewSessionModalOpen(true, project.id);
      },
    },
    { type: "divider" },
    {
      key: "rename",
      label: "重命名分类",
      icon: <EditOutlined />,
      onClick: () => handleRenameCategory(category),
    },
    {
      key: "delete",
      label: "删除分类",
      icon: <DeleteOutlined />,
      danger: true,
      onClick: () => handleDeleteCategory(category),
    },
  ];

  const getSessionContextMenu = (session: Session): MenuProps["items"] => [
    {
      key: "rename",
      label: "重命名会话",
      icon: <EditOutlined />,
      onClick: () => handleRenameSession(session),
    },
    { type: "divider" as const },
    {
      key: "delete",
      label: "删除会话",
      icon: <DeleteOutlined />,
      danger: true,
      onClick: () => {
        Modal.confirm({
          title: "删除会话",
          content: `确认删除会话「${session.title || TOOL_DISPLAY_NAMES[session.toolType]}」？此操作不可恢复。`,
          okText: "删除",
          cancelText: "取消",
          okButtonProps: { danger: true },
          onOk: () => deleteSession(session.id),
        });
      },
    },
  ];

  const renderSessionItem = (session: Session, indentLeft: string = "pl-8", _categoryId?: string) => {
    const isActive = session.id === activeTabId;
    const isOpen = openTabIds.includes(session.id);
    const isHovered = hoveredSessionId === session.id;
    const isRenaming = session.id === renamingSessionId;
    const isDragging = draggingSessionId === session.id;
    const toolColor = TOOL_COLORS[session.toolType] || "#888";

    let textColor: string;
    let borderStyle: string;
    let bgColor: string | undefined;

    if (isActive) {
      textColor = "var(--ant-color-text)";
      borderStyle = "2px solid var(--ant-color-primary)";
      bgColor = "var(--ant-color-bg-elevated)";
    } else if (isOpen) {
      textColor = "var(--ant-color-text-secondary)";
      borderStyle = "2px solid var(--ant-color-primary-border)";
    } else {
      textColor = "var(--ant-color-text-tertiary)";
      borderStyle = "2px solid transparent";
    }

    return (
      <Dropdown
        key={session.id}
        menu={{ items: getSessionContextMenu(session) }}
        trigger={["contextMenu"]}
      >
        <div
          draggable
          onDragStart={(e) => handleDragStart(e, session.id)}
          onDragEnd={handleDragEnd}
          onClick={() => {
            if (isRenaming) return;
            if (isOpen) {
              setActiveTab(session.id);
            } else {
              openTab(session.id);
            }
          }}
          onMouseEnter={() => setHoveredSessionId(session.id)}
          onMouseLeave={() => setHoveredSessionId(null)}
          className={`relative flex items-center min-w-0 ${indentLeft} py-1.5 text-xs cursor-pointer transition-colors ${isDragging ? "opacity-50" : ""}`}
          style={{
            color: textColor,
            borderLeft: borderStyle,
            backgroundColor: isHovered && !isActive ? "var(--ant-color-bg-elevated)" : bgColor,
          }}
        >
          {TOOL_ICONS[session.toolType as ToolType] ? (
            <span
              className="mr-2 flex-shrink-0"
              style={{ color: session.color || toolColor }}
            >
              {TOOL_ICONS[session.toolType as ToolType]}
            </span>
          ) : (
            <span
              className="inline-block w-1.5 h-1.5 rounded-full mr-2 flex-shrink-0"
              style={{ backgroundColor: session.color || toolColor }}
            />
          )}
          {isRenaming ? (
            <Input
              size="small"
              value={renamingSessionValue}
              onChange={(e) => setRenamingSessionValue(e.target.value)}
              onPressEnter={confirmRenameSession}
              onBlur={confirmRenameSession}
              className="flex-1 min-w-0"
              style={{ fontSize: 12 }}
              onClick={(e) => e.stopPropagation()}
              autoFocus
            />
          ) : (
            <span className="flex-1 min-w-0 truncate">
              {session.title || TOOL_DISPLAY_NAMES[session.toolType]}
            </span>
          )}
          {/* 图标区域：固定在右侧 */}
          {!isRenaming && (
            <span className="flex items-center gap-1.5 flex-shrink-0 ml-auto pl-2">
              {isOpen && (
                <>
                  {isActive && (
                    <FireOutlined style={{ fontSize: 10, color: "#f5222d" }} />
                  )}
                  <EyeOutlined style={{ fontSize: 10, color: "#1890ff" }} />
                </>
              )}
              {session.isRunning && (
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full bg-[#52c41a]"
                  style={{ animation: "pulse-dot 2s ease-in-out infinite" }}
                />
              )}
            </span>
          )}
        </div>
      </Dropdown>
    );
  };

  const renderCategoryNode = (category: SessionCategory) => {
    const categorySessions = sessions.filter(
      (s) => s.projectId === project.id && s.categoryId === category.id,
    );
    const isCollapsed = collapsedCategoryIds.includes(category.id);
    const isRenaming = category.id === renamingCategoryId;
    const isDragOver = draggingSessionId !== null;

    return (
      <div
        key={category.id}
        className="mb-0.5 w-full min-w-0"
        onDragOver={(e) => handleDragOver(e, category.id)}
        onDrop={(e) => handleDrop(e, category.id)}
        onDragLeave={() => {}}
      >
        <Dropdown
          menu={{ items: getCategoryContextMenu(category) }}
          trigger={["contextMenu"]}
        >
          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs text-[var(--ant-color-text-secondary)] cursor-pointer hover:text-[var(--ant-color-text)] transition-colors group min-w-0 ${isDragOver ? "bg-[var(--ant-color-primary-bg)]" : ""}`}
            style={{ paddingLeft: "24px" }}
            onClick={() => toggleCategoryCollapsed(category.id)}
          >
            <FolderOpenOutlined style={{ fontSize: 12, color: category.color || undefined }} />
            {isRenaming ? (
              <Input
                size="small"
                value={renamingCategoryValue}
                onChange={(e) => setRenamingCategoryValue(e.target.value)}
                onPressEnter={confirmRenameCategory}
                onBlur={confirmRenameCategory}
                className="flex-1"
                style={{ fontSize: 12 }}
                onClick={(e) => e.stopPropagation()}
                autoFocus
              />
            ) : (
              <span className="truncate flex-1">{category.name}</span>
            )}
            {/* 新建会话图标 - 带边框 */}
            <div
              className="opacity-0 group-hover:opacity-100 flex items-center justify-center w-4 h-4 rounded border border-[var(--ant-color-border)] hover:border-[var(--ant-color-primary)] hover:text-[var(--ant-color-primary)] transition-all flex-shrink-0"
              style={{ fontSize: 10 }}
              onClick={(e) => {
                e.stopPropagation();
                setNewSessionModalOpen(true, project.id);
              }}
            >
              <PlusOutlined />
            </div>
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
        {!isCollapsed && categorySessions.map((s) => renderSessionItem(s, "pl-12", category.id))}
      </div>
    );
  };

  return (
    <div
      className="mb-0.5 w-full min-w-0"
      onDragOver={handleDragOverProject}
      onDrop={handleDropToProject}
    >
      <Dropdown menu={{ items: contextMenuItems }} trigger={["contextMenu"]}>
        <div
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[var(--ant-color-text-tertiary)] cursor-pointer hover:text-[var(--ant-color-text-secondary)] transition-colors group font-medium min-w-0"
          onClick={() => toggleProjectCollapsed(project.id)}
        >
          <FolderOutlined style={{ fontSize: 12, color: project.color || undefined }} />
          {renaming ? (
            <Input
              size="small"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onPressEnter={confirmRename}
              onBlur={confirmRename}
              className="flex-1"
              style={{ fontSize: 12 }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="truncate flex-1 font-medium">{project.name}</span>
          )}
          {/* 新建分类图标 - 带边框 */}
          <div
            className="opacity-0 group-hover:opacity-100 flex items-center justify-center w-4 h-4 rounded border border-[var(--ant-color-border)] hover:border-[var(--ant-color-primary)] hover:text-[var(--ant-color-primary)] transition-all flex-shrink-0"
            style={{ fontSize: 10 }}
            onClick={(e) => {
              e.stopPropagation();
              handleNewCategory();
            }}
          >
            <PlusOutlined />
          </div>
          {/* 新建会话图标 */}
          <PlusOutlined
            className="opacity-0 group-hover:opacity-100 text-[10px] hover:text-[var(--ant-color-primary)] transition-opacity flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              handleNewSession();
            }}
          />
          <span
            style={{
              fontSize: 10,
              transform: isCollapsed ? "rotate(-90deg)" : "none",
              transition: "transform 0.2s",
            }}
          >
            ▼
          </span>
        </div>
      </Dropdown>
      {!isCollapsed && (
        <>
          {projectCategories.map(renderCategoryNode)}
          {uncategorizedSessions.map((s) => renderSessionItem(s, "pl-6"))}
        </>
      )}
    </div>
  );
}
