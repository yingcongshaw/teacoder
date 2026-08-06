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
    <div className="w-full h-full bg-[#202023] flex flex-col">
      {/* Search bar */}
      <div className="px-3 pt-2 pb-2 flex-shrink-0">
        <Input
          size="small"
          placeholder="搜索项目/会话..."
          prefix={<SearchOutlined className="text-[#555555]" />}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          allowClear
          style={{
            backgroundColor: "#252830",
            borderColor: "#2a2d38",
            color: "#cccccc",
            borderRadius: 6,
          }}
        />
      </div>

      {/* Projects section header */}
      <div className="px-3 py-1.5 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <FolderOutlined style={{ fontSize: 11, color: "#888888" }} />
          <span className="text-xs text-[#888888] font-medium">项目</span>
          <Badge
            count={projects.length}
            style={{ backgroundColor: "#2a2d38", color: "#aaaaaa", fontSize: 10 }}
            size="small"
          />
        </div>
        <Tooltip title="新建项目">
          <Button
            type="text"
            size="small"
            icon={<PlusOutlined style={{ fontSize: 12, color: "#888888" }} />}
            onClick={() => setNewProjectModalOpen(true)}
            style={{ color: "#888888" }}
          />
        </Tooltip>
      </div>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {filteredProjects.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <p className="text-xs text-[#666666] mb-3">
              {searchQuery.trim() ? "未找到匹配项" : "暂无项目"}
            </p>
            {!searchQuery.trim() && (
              <div className="flex flex-col gap-2 items-center">
                <Button
                  type="primary"
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => setNewProjectModalOpen(true)}
                  style={{ backgroundColor: "#3b82f6", borderColor: "#3b82f6" }}
                >
                  新建项目
                </Button>
                <Button
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => setNewSessionModalOpen(true)}
                  style={{ color: "#888888", borderColor: "#2a2d38" }}
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
            />
          ))
        )}
      </div>
    </div>
  );
}
