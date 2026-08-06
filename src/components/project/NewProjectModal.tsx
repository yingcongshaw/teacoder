import { useState } from "react";
import { Modal, Input, App } from "antd";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../../stores/appStore";

const PROJECT_COLORS = [
  "#3b82f6", "#722ed1", "#1890ff", "#52c41a",
  "#fa8c16", "#eb2f96", "#f5222d", "#888888",
];

interface NewProjectModalProps {
  open: boolean;
  onClose: () => void;
}

export default function NewProjectModal({ open, onClose }: NewProjectModalProps) {
  const createProject = useAppStore((s) => s.createProject);
  const toggleProjectCollapsed = useAppStore((s) => s.toggleProjectCollapsed);
  const collapsedProjectIds = useAppStore((s) => s.collapsedProjectIds);
  const { message } = App.useApp();

  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [color, setColor] = useState(PROJECT_COLORS[0]);
  const [loading, setLoading] = useState(false);

  const handleBrowse = async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (selected && typeof selected === "string") {
      setPath(selected);
      if (!name.trim()) {
        const dirName = selected.split(/[/\\]/).pop() || selected;
        setName(dirName);
      }
    }
  };

  const handleOk = async () => {
    if (!name.trim()) {
      message.warning("请输入项目名称");
      return;
    }
    if (!path.trim()) {
      message.warning("请输入项目路径");
      return;
    }
    setLoading(true);
    try {
      const project = await createProject(name.trim(), path.trim(), color);
      // 确保新项目展开
      if (collapsedProjectIds.includes(project.id)) {
        toggleProjectCollapsed(project.id);
      }
      resetAndClose();
      message.success("项目已创建");
    } catch (e) {
      message.error(`创建失败：${e}`);
    } finally {
      setLoading(false);
    }
  };

  const resetAndClose = () => {
    setName("");
    setPath("");
    setColor(PROJECT_COLORS[0]);
    onClose();
  };

  return (
    <Modal
      title="新建项目"
      open={open}
      onOk={handleOk}
      onCancel={resetAndClose}
      okText="创建"
      cancelText="取消"
      confirmLoading={loading}
      width={460}
      destroyOnClose
    >
      <div className="space-y-4 mt-2">
        <div>
          <label className="block text-xs text-gray-400 mb-1">项目名称</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-project"
            onPressEnter={handleOk}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">项目路径</label>
          <Input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="~/projects/my-project"
            addonAfter={
              <span
                className="cursor-pointer text-xs text-[#3b82f6]"
                onClick={handleBrowse}
              >
                浏览
              </span>
            }
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">颜色标记</label>
          <div className="flex gap-2">
            {PROJECT_COLORS.map((c) => (
              <span
                key={c}
                className="inline-block w-5 h-5 rounded-full cursor-pointer border-2 transition-transform"
                style={{
                  backgroundColor: c,
                  borderColor: color === c ? "#e0e0e0" : "transparent",
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
