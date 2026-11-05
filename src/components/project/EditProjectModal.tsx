import { useEffect, useState } from "react";
import { Modal, Input, App } from "antd";
import { useAppStore } from "../../stores/appStore";
import { COLOR_PALETTE } from "../../utils/colorPalette";
import ProjectEnvSelects from "./ProjectEnvSelects";

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
  const [color, setColor] = useState(COLOR_PALETTE[0]);
  const [devEnvIds, setDevEnvIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!project) return;
    setName(project.name);
    setColor(project.color || COLOR_PALETTE[0]);
    setDevEnvIds(project.devEnvIds ?? []);
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
        devEnvIds,
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
        <ProjectEnvSelects
          devEnvIds={devEnvIds}
          onChange={(next) => setDevEnvIds(next.devEnvIds)}
        />
        <div>
          <label className="block text-xs text-[var(--ant-color-text-secondary)] mb-1">颜色标记</label>
          <div className="flex gap-2">
            {COLOR_PALETTE.map((c) => (
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
      </div>
    </Modal>
  );
}
