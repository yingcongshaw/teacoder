import { useState, useMemo } from "react";
import { Button, Input, Tooltip, Badge } from "antd";
import {
  PlusOutlined,
  SearchOutlined,
  FolderOutlined,
} from "@ant-design/icons";
import { useAppStore } from "../../stores/appStore";
import ProjectNode from "../project/ProjectNode";

export default function AppSidebar() {
  const projects = useAppStore((s) => s.projects);
  const sessions = useAppStore((s) => s.sessions);
  const categories = useAppStore((s) => s.categories);
  const setNewProjectModalOpen = useAppStore((s) => s.setNewProjectModalOpen);
  const setNewSessionModalOpen = useAppStore((s) => s.setNewSessionModalOpen);

  const [searchQuery, setSearchQuery] = useState("");

  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return projects;
    const query = searchQuery.toLowerCase();
    return projects.filter((p) => {
      if (p.name.toLowerCase().includes(query)) return true;
      if (p.path.toLowerCase().includes(query)) return true;
      // 也匹配该项目下的会话
      const projectSessions = sessions.filter((s) => s.projectId === p.id);
      return projectSessions.some(
        (s) =>
          (s.title || "").toLowerCase().includes(query) ||
          s.toolType.toLowerCase().includes(query),
      );
    });
  }, [projects, sessions, searchQuery]);

  const getProjectSessions = (projectId: string) =>
    sessions.filter((s) => s.projectId === projectId);

  return (
    <div className="h-full w-full bg-[var(--ant-color-bg-container)] flex flex-col min-w-0">
      {/* Search bar */}
      <div className="px-3 pt-2 pb-2 flex-shrink-0">
        <Input
          size="small"
          placeholder="搜索项目/会话..."
          prefix={<SearchOutlined className="text-[var(--ant-color-text-quaternary)]" />}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          allowClear
          style={{
            backgroundColor: "var(--ant-color-bg-elevated)",
            borderColor: "var(--ant-color-border)",
            color: "var(--ant-color-text)",
            borderRadius: 6,
          }}
        />
      </div>

      {/* Projects section header */}
      <div className="px-3 py-1.5 flex items-center justify-between flex-shrink-0 border-b border-[var(--ant-color-border)]">
        <div className="flex items-center gap-1.5">
          <FolderOutlined style={{ fontSize: 13, color: "var(--ant-color-primary)" }} />
          <span className="text-xs text-[var(--ant-color-text-secondary)] font-semibold tracking-wide">项目</span>
          <Badge
            count={projects.length}
            style={{ backgroundColor: "var(--ant-color-bg-elevated)", color: "var(--ant-color-text-secondary)", fontSize: 10 }}
            size="small"
          />
        </div>
        <Tooltip title="新建项目">
          <Button
            type="text"
            size="small"
            icon={<PlusOutlined style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)" }} />}
            onClick={() => setNewProjectModalOpen(true)}
            style={{ color: "var(--ant-color-text-tertiary)" }}
          />
        </Tooltip>
      </div>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto min-h-0 w-full min-w-0">
        {filteredProjects.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <p className="text-xs text-[var(--ant-color-text-disabled)] mb-3">
              {searchQuery.trim() ? "未找到匹配项" : "暂无项目"}
            </p>
            {!searchQuery.trim() && (
              <div className="flex flex-col gap-2 items-center">
                <Button
                  type="primary"
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => setNewProjectModalOpen(true)}
                >
                  新建项目
                </Button>
                <Button
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => setNewSessionModalOpen(true)}
                  style={{ color: "var(--ant-color-text-tertiary)", borderColor: "var(--ant-color-border)" }}
                >
                  新建会话
                </Button>
              </div>
            )}
          </div>
        ) : (
          filteredProjects.map((project) => (
            <ProjectNode
              key={project.id}
              project={project}
              sessions={getProjectSessions(project.id)}
              categories={categories}
            />
          ))
        )}
      </div>
    </div>
  );
}
