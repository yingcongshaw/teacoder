import { useState, useMemo } from "react";
import { Button, Input, Tooltip, Badge, Modal } from "antd";
import {
  PlusOutlined,
  SearchOutlined,
  MessageOutlined,
  FolderOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import { useAppStore } from "../../stores/appStore";
import { TOOL_DISPLAY_NAMES } from "../../types";
import type { TabState } from "../../types";
import CliToolStatus from "../cli/CliToolStatus";

const TOOL_COLORS: Record<string, string> = {
  claude: "#722ed1",
  codex: "#1890ff",
  gemini: "#1677ff",
  opencode: "#fa8c16",
};

export default function AppSidebar() {
  const sessions = useAppStore((s) => s.sessions);
  const openTabIds = useAppStore((s) => s.openTabIds);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const openTab = useAppStore((s) => s.openTab);
  const deleteSession = useAppStore((s) => s.deleteSession);
  const setNewSessionModalOpen = useAppStore((s) => s.setNewSessionModalOpen);
  const collapsedProjects = useAppStore((s) => s.collapsedProjects);
  const toggleProjectCollapsed = useAppStore((s) => s.toggleProjectCollapsed);

  const [searchQuery, setSearchQuery] = useState("");

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    const query = searchQuery.toLowerCase();
    return sessions.filter(
      (s) =>
        (s.title || "").toLowerCase().includes(query) ||
        s.workDir.toLowerCase().includes(query) ||
        s.toolType.toLowerCase().includes(query),
    );
  }, [sessions, searchQuery]);

  const groupedSessions = useMemo(() => {
    const groups: Record<string, TabState[]> = {};
    for (const session of filteredSessions) {
      const dir = session.workDir.split(/[/\\]/).pop() || session.workDir;
      if (!groups[dir]) groups[dir] = [];
      groups[dir].push(session);
    }
    return groups;
  }, [filteredSessions]);

  const [hoveredTabId, setHoveredTabId] = useState<string | null>(null);

  const renderTabItem = (session: TabState) => {
    const isActive = session.id === activeTabId;
    const isOpen = openTabIds.includes(session.id);
    const isHovered = hoveredTabId === session.id;
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
        onMouseEnter={() => setHoveredTabId(session.id)}
        onMouseLeave={() => setHoveredTabId(null)}
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
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#52c41a] mr-1 flex-shrink-0" style={{ animation: "pulse-dot 2s ease-in-out infinite" }} />
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
    <div className="w-full h-full bg-[#202023] flex flex-col">
      {/* CLI tool icons */}
      <CliToolStatus />

      {/* Search bar */}
      <div className="px-3 pt-1 pb-2 flex-shrink-0">
        <Input
          size="small"
          placeholder="搜索会话..."
          prefix={<SearchOutlined className="text-[#555555]" />}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          allowClear
          style={{ backgroundColor: "#252830", borderColor: "#2a2d38", color: "#cccccc", borderRadius: 6 }}
        />
      </div>

      {/* Sessions section header */}
      <div className="px-3 py-1.5 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <MessageOutlined style={{ fontSize: 11, color: "#888888" }} />
          <span className="text-xs text-[#888888] font-medium">会话</span>
          <Badge
            count={sessions.length}
            style={{ backgroundColor: "#2a2d38", color: "#aaaaaa", fontSize: 10 }}
            size="small"
          />
        </div>
        <Tooltip title="新建会话">
          <Button
            type="text"
            size="small"
            icon={<PlusOutlined style={{ fontSize: 12, color: "#888888" }} />}
            onClick={() => setNewSessionModalOpen(true)}
            style={{ color: "#888888" }}
          />
        </Tooltip>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {filteredSessions.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <p className="text-xs text-[#666666] mb-3">暂无会话</p>
            <Button
              type="primary"
              size="small"
              icon={<PlusOutlined />}
              onClick={() => setNewSessionModalOpen(true)}
              style={{ backgroundColor: "#3b82f6", borderColor: "#3b82f6" }}
            >
              新建会话
            </Button>
          </div>
        ) : (
          Object.entries(groupedSessions).map(([dir, groupSessions]) => {
            const isCollapsed = collapsedProjects.includes(dir);
            return (
              <div key={dir} className="mb-0.5">
                {/* Project header */}
                <div
                  className="flex items-center gap-1.5 px-3 py-1 text-[10px] text-[#666666] cursor-pointer hover:text-[#999999] transition-colors"
                  onClick={() => toggleProjectCollapsed(dir)}
                >
                  <FolderOutlined style={{ fontSize: 10 }} />
                  <span className="truncate flex-1">{dir}</span>
                  <span style={{ fontSize: 9, transform: isCollapsed ? "rotate(-90deg)" : "none", transition: "transform 0.2s" }}>▼</span>
                </div>
                {/* Project sessions */}
                {!isCollapsed && groupSessions.map(renderTabItem)}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
