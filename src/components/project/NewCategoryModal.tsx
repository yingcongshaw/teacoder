import { useState } from "react";
import { Modal, Input, App } from "antd";
import { useAppStore } from "../../stores/appStore";

const CATEGORY_COLORS = [
  "#722ed1", "#1890ff", "#1677ff", "#fa8c16",
  "#52c41a", "#13c2c2", "#eb2f96", "#ff4d4f",
];

interface NewCategoryModalProps {
  open: boolean;
  projectId: string | null;
  onClose: () => void;
}

export default function NewCategoryModal({ open, projectId, onClose }: NewCategoryModalProps) {
  const createCategory = useAppStore((s) => s.createCategory);
  const { message } = App.useApp();

  const [name, setName] = useState("");
  const [color, setColor] = useState(CATEGORY_COLORS[0]);
  const [loading, setLoading] = useState(false);

  const handleOk = async () => {
    if (!name.trim()) {
      message.warning("请输入分类名称");
      return;
    }
    if (!projectId) {
      message.warning("请先选择项目");
      return;
    }
    setLoading(true);
    try {
      await createCategory({ projectId, name: name.trim(), color });
      message.success("会话分类已创建");
      resetAndClose();
    } catch (e) {
      message.error(`创建失败：${e}`);
    } finally {
      setLoading(false);
    }
  };

  const resetAndClose = () => {
    setName("");
    setColor(CATEGORY_COLORS[0]);
    onClose();
  };

  return (
    <Modal
      title="新建会话分类"
      open={open}
      onOk={handleOk}
      onCancel={resetAndClose}
      okText="创建"
      cancelText="取消"
      confirmLoading={loading}
      width={400}
      destroyOnHidden
      mask={{ closable: false }}
    >
      <div className="space-y-4 mt-2">
        <div>
          <label className="block text-xs text-[var(--ant-color-text-secondary)] mb-1">分类名称</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="输入分类名称"
            onPressEnter={handleOk}
            autoFocus
          />
        </div>
        <div>
          <label className="block text-xs text-[var(--ant-color-text-secondary)] mb-1">颜色标记</label>
          <div className="flex gap-2">
            {CATEGORY_COLORS.map((c) => (
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
