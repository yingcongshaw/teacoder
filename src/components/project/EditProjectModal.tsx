import { useEffect, useState } from "react";
import { Modal, Input, App } from "antd";
import { useAppStore } from "../../stores/appStore";
import ProjectEnvSelects from "./ProjectEnvSelects";

const PROJECT_COLORS = [
  "#3b82f6", "#722ed1", "#1890ff", "#52c41a",
  "#fa8c16", "#eb2f96", "#f5222d", "#888888",
];

/**
 * 编辑项目弹窗。
 *
 * 项目路径锁定不可改：路径是会话工作目录与服务工作目录的来源，
 * 改掉等于把已有会话指向另一处，用户很难察觉。
 */
export default function EditProjectModal() {
  const { message } = App.useApp();
  const setEditingProjectId = useAppStore((s) => s.setEditingProjectId);
  const project = useAppStore((s) => s.projects.find((p) => p.id === s.editingProjectId));
  const updateProject = useAppStore((s) => s.updateProject);

  const [name, setName] = useState("");
  const [color, setColor] = useState(PROJECT_COLORS[0]);
  const [javaEnvId, setJavaEnvId] = useState<string | undefined>(undefined);
  const [nodeEnvId, setNodeEnvId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!project) return;
    setName(project.name);
    setColor(project.color || PROJECT_COLORS[0]);
    setJavaEnvId(project.javaEnvId);
    setNodeEnvId(project.nodeEnvId);
  }, [project]);

  const close = () => setEditingProjectId(null);

  const handleOk = async () => {
    if (!project) return;
    if (!name.trim()) {
      message.warning("请输入项目名称");
      return;
    }
    setLoading(true);
    try {
      await updateProject(project.id, {
        name: name.trim(),
        color,
        javaEnvId: javaEnvId ?? null,
        nodeEnvId: nodeEnvId ?? null,
      });
      message.success("项目已更新");
      close();
    } catch (e) {
      message.error(`更新失败：${e}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="编辑项目"
      open={!!project}
      onOk={handleOk}
      onCancel={close}
      okText="保存"
      cancelText="取消"
      confirmLoading={loading}
      width={460}
      destroyOnHidden
      mask={{ closable: false }}
    >
      <div className="space-y-4 mt-2">
        <div>
          <label className="block text-xs text-[var(--ant-color-text-secondary)] mb-1">项目名称</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs text-[var(--ant-color-text-secondary)] mb-1">项目路径</label>
          <Input value={project?.path || ""} disabled />
          <div className="text-xs text-[var(--ant-color-text-tertiary)] mt-1">
            项目路径不可修改
          </div>
        </div>
        <div>
          <label className="block text-xs text-[var(--ant-color-text-secondary)] mb-1">颜色标记</label>
          <div className="flex gap-2">
            {PROJECT_COLORS.map((c) => (
              <span
                key={c}
                className="inline-block w-5 h-5 rounded-full cursor-pointer border-2 transition-transform"
                style={{
                  backgroundColor: c,
                  borderColor: color === c ? "var(--ant-color-border)" : "transparent",
                  transform: color === c ? "scale(1.2)" : "scale(1)",
                }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs text-[var(--ant-color-text-secondary)] mb-1">运行环境</label>
          <ProjectEnvSelects
            javaEnvId={javaEnvId}
            nodeEnvId={nodeEnvId}
            onChange={(next) => {
              setJavaEnvId(next.javaEnvId);
              setNodeEnvId(next.nodeEnvId);
            }}
          />
        </div>
      </div>
    </Modal>
  );
}
