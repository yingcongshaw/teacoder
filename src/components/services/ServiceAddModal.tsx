import { useEffect, useState } from "react";
import { Modal, Input, Select, App } from "antd";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../../stores/appStore";
import { serviceCreate } from "../../utils/ipc";

interface ServiceAddModalProps {
  open: boolean;
  onClose: () => void;
  /** 默认选中的项目 */
  defaultProjectId?: string;
  /** 是否允许切换项目（面板处于「所有项目」时需要） */
  allowProjectSelect?: boolean;
}

export default function ServiceAddModal({
  open,
  onClose,
  defaultProjectId,
  allowProjectSelect,
}: ServiceAddModalProps) {
  const { message } = App.useApp();
  const projects = useAppStore((s) => s.projects);

  const [projectId, setProjectId] = useState<string | undefined>(defaultProjectId);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [workingDir, setWorkingDir] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setProjectId(defaultProjectId);
      setName("");
      setCommand("");
      setWorkingDir("");
    }
  }, [open, defaultProjectId]);

  const browse = async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (selected && typeof selected === "string") {
      setWorkingDir(selected);
    }
  };

  const handleOk = async () => {
    if (!projectId) {
      message.warning("请选择所属项目");
      return;
    }
    if (!name.trim()) {
      message.warning("请输入服务名称");
      return;
    }
    if (!command.trim()) {
      message.warning("请输入启动命令");
      return;
    }
    setLoading(true);
    try {
      await serviceCreate({
        projectId,
        name: name.trim(),
        command: command.trim(),
        workingDir: workingDir.trim() || undefined,
      });
      message.success("服务已添加");
      onClose();
    } catch (e) {
      message.error(`添加失败：${e}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="添加服务"
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      okText="添加"
      cancelText="取消"
      confirmLoading={loading}
      width={520}
      destroyOnHidden
    >
      <div className="space-y-4 mt-2">
        {allowProjectSelect && (
          <div>
            <label className="block text-xs text-[var(--ant-color-text-secondary)] mb-1">所属项目</label>
            <Select
              className="w-full"
              placeholder="选择项目"
              value={projectId}
              onChange={setProjectId}
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
            />
          </div>
        )}
        <div>
          <label className="block text-xs text-[var(--ant-color-text-secondary)] mb-1">服务名称</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：用户服务"
          />
        </div>
        <div>
          <label className="block text-xs text-[var(--ant-color-text-secondary)] mb-1">启动命令</label>
          <Input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="例如：mvn spring-boot:run"
          />
          <div className="text-xs text-[var(--ant-color-text-tertiary)] mt-1">
            不带 shell 语法，不支持管道与重定向
          </div>
        </div>
        <div>
          <label className="block text-xs text-[var(--ant-color-text-secondary)] mb-1">工作目录</label>
          <Input
            value={workingDir}
            onChange={(e) => setWorkingDir(e.target.value)}
            placeholder="留空则用项目路径"
            addonAfter={
              <span
                className="cursor-pointer text-xs text-[var(--ant-color-primary)]"
                onClick={browse}
              >
                浏览
              </span>
            }
          />
        </div>
      </div>
    </Modal>
  );
}
