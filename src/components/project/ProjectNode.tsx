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
  RightSquareOutlined,
  CopyOutlined,
} from "@ant-design/icons";
import { useAppStore } from "../../stores/appStore";
import { TOOL_DISPLAY_NAMES } from "../../types";
import type { Project, Session, ToolType, SessionCategory } from "../../types";
import { openPathInFileManager, openTerminal } from "../../utils/ipc";
import { reportOpenTabError } from "../../utils/openTabError";
import {
  buildSessionMoves,
  readDragPayload,
  reorderIds,
  resolveSessionDrop,
  writeDragPayload,
} from "../../utils/sidebarSort";
import type { SidebarDrag } from "../../utils/sidebarSort";

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

/** 可以作为落点的行。提示线画在哪一行、这次拖拽算什么，全看这个。 */
type DropRowKind = "session" | "category" | "project";

/** 落点提示：插到某行之前 / 之后。做成字符串便于比较，避免 dragover 时反复 setState。 */
function dropKeyOf(rowKind: DropRowKind, rowId: string, after: boolean) {
  return `${rowKind}:${rowId}:${after ? "after" : "before"}`;
}

/** 落点提示线。行本身是 relative，线绝对定位在行的上沿或下沿。 */
function DropIndicator({ at }: { at: "before" | "after" }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        height: 2,
        backgroundColor: "var(--ant-color-primary)",
        top: at === "before" ? -1 : undefined,
        bottom: at === "after" ? -1 : undefined,
        pointerEvents: "none",
        zIndex: 1,
      }}
    />
  );
}

interface ProjectNodeProps {
  project: Project;
  sessions: Session[];
  categories: SessionCategory[];
  /**
   * 是否允许项目换位。侧边栏搜索时列表是过滤过的，视口里的先后不等于真实顺序，
   * 此时按上下半重排会算错，所以由 AppSidebar 关掉。
   */
  reorderEnabled?: boolean;
}

export default function ProjectNode({
  project,
  sessions,
  categories,
  reorderEnabled = true,
}: ProjectNodeProps) {
  const projects = useAppStore((s) => s.projects);
  // 重排计算要跨项目看全量会话（拖到别的项目上时源分组在另一个项目里），不能只拿 props
  const allSessions = useAppStore((s) => s.sessions);
  const openTabIds = useAppStore((s) => s.openTabIds);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const openTab = useAppStore((s) => s.openTab);
  const deleteSession = useAppStore((s) => s.deleteSession);
  const duplicateSession = useAppStore((s) => s.duplicateSession);
  const updateSession = useAppStore((s) => s.updateSession);
  const deleteProject = useAppStore((s) => s.deleteProject);
  const updateProject = useAppStore((s) => s.updateProject);
  const reorderProjects = useAppStore((s) => s.reorderProjects);
  const reorderSessions = useAppStore((s) => s.reorderSessions);
  const reorderCategories = useAppStore((s) => s.reorderCategories);
  const setNewSessionModalOpen = useAppStore((s) => s.setNewSessionModalOpen);
  const collapsedProjectIds = useAppStore((s) => s.collapsedProjectIds);
  const toggleProjectCollapsed = useAppStore((s) => s.toggleProjectCollapsed);
  const collapsedCategoryIds = useAppStore((s) => s.collapsedCategoryIds);
  const toggleCategoryCollapsed = useAppStore((s) => s.toggleCategoryCollapsed);
  const setNewCategoryModalOpen = useAppStore((s) => s.setNewCategoryModalOpen);
  const setEditSessionModalOpen = useAppStore((s) => s.setEditSessionModalOpen);
  const updateCategory = useAppStore((s) => s.updateCategory);
  const deleteCategory = useAppStore((s) => s.deleteCategory);
  const { message } = App.useApp();

  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
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

  /** 手上正拖着什么。HTML5 DnD 在 dragover 阶段读不到 dataTransfer，只能靠这个。 */
  const [drag, setDrag] = useState<SidebarDrag | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);

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
    setNewCategoryModalOpen(true, project.id);
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
        message.success("已重命名会话分类");
      }
      setRenamingCategoryId(null);
    }
  };

  const handleDeleteCategory = (category: SessionCategory) => {
    Modal.confirm({
      title: "删除会话分类",
      content: `确认删除会话分类「${category.name}」？该分类下的会话将移至项目根目录。`,
      okText: "删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: () => deleteCategory(category.id),
    });
  };

  const handleDragEnd = () => {
    setDrag(null);
    setDropKey(null);
  };

  /** 这一行认不认当前手上的手势。不认就 return，让事件继续冒泡给外层原有逻辑。 */
  const accepts = (payload: SidebarDrag, rowKind: DropRowKind, rowId: string): boolean => {
    if (payload.id === rowId && payload.kind === rowKind) return false;
    if (payload.kind === "session") return true;
    if (payload.kind === "category") return rowKind === "category";
    // 项目重排只在列表未被搜索过滤时开放
    return rowKind === "project" && reorderEnabled;
  };

  const handleDrop = async (
    payload: SidebarDrag,
    rowKind: DropRowKind,
    rowId: string,
    after: boolean,
  ) => {
    if (payload.kind === "session") {
      const target = resolveSessionDrop(
        allSessions,
        categories,
        payload.id,
        rowKind,
        rowId,
        after,
      );
      if (!target) return;
      const moves = buildSessionMoves(
        allSessions,
        payload.id,
        target.projectId,
        target.categoryId,
        target.index,
      );
      if (!moves.length) return;
      const dragged = allSessions.find((s) => s.id === payload.id);
      const changedGroup =
        !dragged ||
        dragged.projectId !== target.projectId ||
        (dragged.categoryId ?? null) !== target.categoryId;
      await reorderSessions(moves);
      // 组内换位不发提示：这时候弹"已移入 XX"是在说一件没发生的事
      if (changedGroup) {
        const categoryName = target.categoryId
          ? categories.find((c) => c.id === target.categoryId)?.name
          : undefined;
        message.success(categoryName ? `已移入「${categoryName}」` : "已移至项目根目录");
      }
      return;
    }

    if (payload.kind === "category") {
      if (rowKind !== "category" || !projectCategories.some((c) => c.id === rowId)) return;
      const ids = reorderIds(projectCategories.map((c) => c.id), payload.id, rowId, after);
      if (ids.join() === projectCategories.map((c) => c.id).join()) return;
      await reorderCategories(ids);
      return;
    }

    if (rowKind !== "project" || !reorderEnabled) return;
    const current = projects.map((p) => p.id);
    const ids = reorderIds(current, payload.id, rowId, after);
    if (ids.join() === current.join()) return;
    await reorderProjects(ids);
  };

  /**
   * 行级落点：按光标落在上沿还是下沿决定插到这一行之前还是之后。
   *
   * `stopPropagation` 是这套逻辑的命脉 —— 外层的分类容器和项目容器也是 drop 目标，
   * 不掐断的话精确插入会被它们抢走，事件冒泡到项目根就把会话丢去项目根目录了。
   */
  const rowDropProps = (rowKind: DropRowKind, rowId: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!drag || !accepts(drag, rowKind, rowId)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      const rect = e.currentTarget.getBoundingClientRect();
      const key = dropKeyOf(rowKind, rowId, e.clientY > rect.top + rect.height / 2);
      if (key !== dropKey) setDropKey(key);
    },
    onDragLeave: (e: React.DragEvent) => {
      // 移进本行的子元素也会触发 dragleave，别把提示擦掉
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      setDropKey((k) => (k?.startsWith(`${rowKind}:${rowId}:`) ? null : k));
    },
    onDrop: async (e: React.DragEvent) => {
      const payload = drag ?? readDragPayload(e);
      if (!payload || !accepts(payload, rowKind, rowId)) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      handleDragEnd();
      await handleDrop(payload, rowKind, rowId, after);
    },
  });

  /**
   * 容器级落点：落在分类 / 项目的空白处时按追加到末尾处理，兼容原来的拖拽手感。
   *
   * 这里也必须掐断冒泡 —— 分类容器嵌在项目容器里，两者都认会话，不掐的话一次 drop
   * 会先命中分类再命中项目，同一条会话被搬两遍，提示线也会被外层覆盖。
   */
  const containerDropProps = (
    rowKind: "category" | "project",
    rowId: string,
    acceptsPayload: (p: SidebarDrag) => boolean,
  ) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!drag || !acceptsPayload(drag)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      const key = dropKeyOf(rowKind, rowId, true);
      if (key !== dropKey) setDropKey(key);
    },
    onDrop: async (e: React.DragEvent) => {
      const payload = drag ?? readDragPayload(e);
      if (!payload || !acceptsPayload(payload)) return;
      e.preventDefault();
      e.stopPropagation();
      handleDragEnd();
      await handleDrop(payload, rowKind, rowId, true);
    },
  });

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
      label: "新建会话分类",
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
    {
      key: "openInFileManager",
      label: "打开文件浏览器",
      icon: <FolderOutlined />,
      onClick: () => openPathInFileManager(project.path),
    },
    {
      key: "openTerminal",
      label: "打开终端",
      icon: <RightSquareOutlined />,
      onClick: () => openTerminal(project.path),
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
        setNewSessionModalOpen(true, project.id, category.id);
      },
    },
    { type: "divider" },
    {
      key: "rename",
      label: "重命名会话分类",
      icon: <EditOutlined />,
      onClick: () => handleRenameCategory(category),
    },
    {
      key: "openInFileManager",
      label: "打开文件浏览器",
      icon: <FolderOutlined />,
      onClick: () => openPathInFileManager(project.path),
    },
    {
      key: "openTerminal",
      label: "打开终端",
      icon: <RightSquareOutlined />,
      onClick: () => openTerminal(project.path),
    },
    { type: "divider" },
    {
      key: "delete",
      label: "删除会话分类",
      icon: <DeleteOutlined />,
      danger: true,
      onClick: () => handleDeleteCategory(category),
    },
  ];

  const getSessionContextMenu = (session: Session): MenuProps["items"] => [
    {
      key: "edit",
      label: "编辑会话",
      icon: <EditOutlined />,
      onClick: () => setEditSessionModalOpen(true, session.id),
    },
    {
      key: "rename",
      label: "重命名会话",
      icon: <EditOutlined />,
      onClick: () => handleRenameSession(session),
    },
    {
      key: "duplicate",
      label: "复制会话",
      icon: <CopyOutlined />,
      onClick: () => {
        duplicateSession(session.id)
          .then((created) => {
            if (created) message.success(`已复制会话「${created.title}」`);
          })
          .catch(() => message.error("复制会话失败"));
      },
    },
    { type: "divider" as const },
    {
      key: "openInFileManager",
      label: "打开文件浏览器",
      icon: <FolderOutlined />,
      onClick: () => {
        const proj = projects.find((p) => p.id === session.projectId);
        if (proj) {
          openPathInFileManager(proj.path);
        }
      },
    },
    {
      key: "openTerminal",
      label: "打开终端",
      icon: <RightSquareOutlined />,
      onClick: () => {
        const proj = projects.find((p) => p.id === session.projectId);
        if (proj) {
          openTerminal(proj.path);
        }
      },
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

  const renderSessionItem = (session: Session, indentLeft: string = "pl-8") => {
    const isActive = session.id === activeTabId;
    const isOpen = openTabIds.includes(session.id);
    const isHovered = hoveredSessionId === session.id;
    const isRenaming = session.id === renamingSessionId;
    const isDragging = drag?.kind === "session" && drag.id === session.id;
    const toolColor = TOOL_COLORS[session.toolType] || "#888";

    let textColor: string;
    let borderStyle: string;
    let bgColor: string | undefined;

    if (isActive) {
      textColor = "#f5222d";
      borderStyle = "2px solid var(--ant-color-primary)";
      bgColor = "var(--ant-color-bg-elevated)";
    } else if (isOpen) {
      textColor = "var(--ant-color-text-secondary)";
      borderStyle = "2px solid var(--ant-color-primary-border)";
    } else {
      textColor = "var(--ant-color-text-tertiary)";
      borderStyle = "2px solid transparent";
    }

    const at = dropKey?.startsWith(`session:${session.id}:`)
      ? dropKey.endsWith(":after")
        ? "after"
        : "before"
      : null;

    return (
      <Dropdown
        key={session.id}
        menu={{ items: getSessionContextMenu(session) }}
        trigger={["contextMenu"]}
      >
        <div
          draggable
          onDragStart={(e) => {
            setDrag({ kind: "session", id: session.id });
            writeDragPayload(e, { kind: "session", id: session.id });
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragEnd={handleDragEnd}
          {...rowDropProps("session", session.id)}
          onClick={() => {
            if (isRenaming) return;
            if (isOpen) {
              setActiveTab(session.id);
            } else {
              openTab(session.id).catch((err) => {
                reportOpenTabError(message, err);
              });
            }
          }}
          onMouseEnter={() => setHoveredSessionId(session.id)}
          onMouseLeave={() => setHoveredSessionId(null)}
          className={`relative flex items-center min-w-0 ${indentLeft} px-3 py-1.5 text-xs cursor-pointer transition-colors ${isDragging ? "opacity-50" : ""}`}
          style={{
            color: textColor,
            borderLeft: borderStyle,
            backgroundColor: isHovered && !isActive ? "var(--ant-color-bg-elevated)" : bgColor,
          }}
        >
          {at && <DropIndicator at={at} />}
          <span className="w-3 flex-shrink-0 flex items-center gap-1.5">
            {TOOL_ICONS[session.toolType as ToolType] ? (
              <span
                style={{ color: session.color || toolColor }}
              >
                {TOOL_ICONS[session.toolType as ToolType]}
              </span>
            ) : (
              <span
                className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: session.color || toolColor }}
              />
            )}
          </span>
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
            <span
              className={`flex-1 min-w-0 truncate ${isActive || isOpen ? "font-semibold" : ""}`}
            >
              {session.title || TOOL_DISPLAY_NAMES[session.toolType]}
            </span>
          )}
          {/* 图标区域：固定在右侧，与三角图标右对齐 */}
          {!isRenaming && (
            <span className="flex items-center gap-1 flex-shrink-0">
              {isActive ? (
                <FireOutlined style={{ fontSize: 10, color: "#f5222d" }} />
              ) : isOpen ? (
                <EyeOutlined style={{ fontSize: 10, color: "#1890ff" }} />
              ) : null}
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
    const isDragging = drag?.kind === "category" && drag.id === category.id;
    const at = dropKey?.startsWith(`category:${category.id}:`)
      ? dropKey.endsWith(":after")
        ? "after"
        : "before"
      : null;

    return (
      <div
        key={category.id}
        className="mb-0.5 w-full min-w-0"
        {...containerDropProps("category", category.id, (p) => p.kind === "session")}
      >
        <Dropdown
          menu={{ items: getCategoryContextMenu(category) }}
          trigger={["contextMenu"]}
        >
          <div
            draggable
            onDragStart={(e) => {
              setDrag({ kind: "category", id: category.id });
              writeDragPayload(e, { kind: "category", id: category.id });
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragEnd={handleDragEnd}
            {...rowDropProps("category", category.id)}
            className={`relative flex items-center gap-1.5 px-3 py-1.5 text-xs text-[var(--ant-color-text-secondary)] cursor-pointer hover:text-[var(--ant-color-text)] transition-colors group min-w-0 ${isDragging ? "opacity-50" : ""}`}
            style={{ paddingLeft: "24px" }}
            onClick={() => toggleCategoryCollapsed(category.id)}
          >
            {at && <DropIndicator at={at} />}
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
                setNewSessionModalOpen(true, project.id, category.id);
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
        {!isCollapsed && categorySessions.map((s) => renderSessionItem(s, "pl-12"))}
      </div>
    );
  };

  const projectAt = dropKey?.startsWith(`project:${project.id}:`)
    ? dropKey.endsWith(":after")
      ? "after"
      : "before"
    : null;

  return (
    <div
      className="mb-0.5 w-full min-w-0 border-t border-[var(--ant-color-border-secondary)]"
      {...containerDropProps("project", project.id, (p) => p.kind === "session")}
    >
      <Dropdown menu={{ items: contextMenuItems }} trigger={["contextMenu"]}>
        <div
          draggable={reorderEnabled}
          onDragStart={(e) => {
            setDrag({ kind: "project", id: project.id });
            writeDragPayload(e, { kind: "project", id: project.id });
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragEnd={handleDragEnd}
          {...rowDropProps("project", project.id)}
          className={`relative flex items-center gap-1.5 px-3 py-1.5 text-xs text-[var(--ant-color-text-tertiary)] cursor-pointer hover:text-[var(--ant-color-text-secondary)] transition-colors group font-medium min-w-0 ${drag?.kind === "project" && drag.id === project.id ? "opacity-50" : ""}`}
          onClick={() => toggleProjectCollapsed(project.id)}
        >
          {projectAt && <DropIndicator at={projectAt} />}
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
          {/* 新建会话分类图标 */}
          <PlusOutlined
            className="opacity-0 group-hover:opacity-100 text-[10px] hover:text-[var(--ant-color-primary)] transition-opacity flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              handleNewCategory();
            }}
          />
          {/* 新建会话图标 - 带边框 */}
          <div
            className="opacity-0 group-hover:opacity-100 flex items-center justify-center w-4 h-4 rounded border border-[var(--ant-color-border)] hover:border-[var(--ant-color-primary)] hover:text-[var(--ant-color-primary)] transition-all flex-shrink-0"
            style={{ fontSize: 10 }}
            onClick={(e) => {
              e.stopPropagation();
              handleNewSession();
            }}
          >
            <PlusOutlined />
          </div>
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