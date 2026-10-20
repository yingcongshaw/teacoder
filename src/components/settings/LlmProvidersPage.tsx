import { useEffect, useState } from 'react';
import { App, Button, Empty, Modal, Switch } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useAppStore } from '../../stores/appStore';
import { listLlmProviderPresets, setDefaultLlmProvider } from '../../utils/ipc';
import type { LlmProvider, PresetProviderView } from '../../types';
import SectionHeader from './components/SectionHeader';
import LlmProviderCard from './components/LlmProviderCard';
import LlmProviderEditModal from './components/LlmProviderEditModal';

/**
 * LLM 供应商设置主页面：负责展示、新建、编辑、删除、启停 LLM Provider 配置。
 * 通过 store 触发持久化操作，store 内部已封装 IPC 调用与列表重载。
 */
export default function LlmProvidersPage() {
  const { message, modal } = App.useApp();
  const llmProviders = useAppStore((s) => s.llmProviders);
  const loadLlmProviders = useAppStore((s) => s.loadLlmProviders);
  const deleteStore = useAppStore((s) => s.deleteLlmProvider);
  const toggleActive = useAppStore((s) => s.toggleLlmProviderActive);

  const [showInactive, setShowInactive] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<LlmProvider | undefined>(undefined);
  const [presetModalOpen, setPresetModalOpen] = useState(false);

  const filtered = showInactive
    ? llmProviders
    : llmProviders.filter((p) => p.isActive);

  const handleSetDefault = async (providerId: string) => {
    try {
      await setDefaultLlmProvider(providerId);
      await loadLlmProviders();
      message.success('已设为默认');
    } catch {
      message.error('设置失败');
    }
  };

  const handleNew = () => {
    setEditing(undefined);
    setModalOpen(true);
  };

  const handleEdit = (p: LlmProvider) => {
    setEditing(p);
    setModalOpen(true);
  };

  const handleDelete = (p: LlmProvider) => {
    modal.confirm({
      title: `删除供应商「${p.name}」？`,
      content: '该操作将停用该供应商，已关联的会话将标记失效',
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteStore(p.id);
          message.success('已停用');
        } catch {
          message.error('删除失败');
        }
      },
    });
  };

  const handleToggleActive = async (p: LlmProvider, checked: boolean) => {
    try {
      await toggleActive(p.id, checked);
      message.success(checked ? '已启用' : '已停用');
    } catch {
      message.error('操作失败');
    }
  };

  return (
    <div>
      <SectionHeader title="LLM 供应商" />

      <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
        <div className="flex gap-2">
          <Button type="primary" icon={<PlusOutlined />} onClick={handleNew}>
            自定义新建
          </Button>
          <Button icon={<PlusOutlined />} onClick={() => setPresetModalOpen(true)}>
            从模板添加
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <span style={{ fontSize: 12 }}>显示已停用</span>
          <Switch size="small" checked={showInactive} onChange={setShowInactive} />
        </div>
      </div>

      {filtered.length === 0 ? (
        <Empty description="暂无供应商" />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {filtered.map((p) => (
            <LlmProviderCard
              key={p.id}
              provider={p}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onToggleActive={handleToggleActive}
              onSetDefault={handleSetDefault}
            />
          ))}
        </div>
      )}

      <LlmProviderEditModal
        open={modalOpen}
        provider={editing}
        onCancel={() => setModalOpen(false)}
        onSaved={() => loadLlmProviders()}
      />

      <PresetPickerModal
        open={presetModalOpen}
        onCancel={() => setPresetModalOpen(false)}
        onPicked={() => {
          setPresetModalOpen(false);
          loadLlmProviders();
        }}
      />
    </div>
  );
}

/**
 * 从预设模板添加 LLM 供应商的弹窗：列出 IPC 返回的预设供应商列表，
 * 点击后将预设数据作为 CreateLlmProviderInput 提交 store。
 */
function PresetPickerModal({
  open,
  onCancel,
  onPicked,
}: {
  open: boolean;
  onCancel: () => void;
  onPicked: () => void;
}) {
  const { message } = App.useApp();
  const createStore = useAppStore((s) => s.createLlmProvider);
  const [presets, setPresets] = useState<PresetProviderView[]>([]);

  useEffect(() => {
    if (open) {
      listLlmProviderPresets()
        .then(setPresets)
        .catch(() => message.error('加载模板失败'));
    }
  }, [open, message]);

  const handlePick = async (preset: PresetProviderView) => {
    try {
      await createStore({
        name: preset.name,
        providerKind: preset.providerKind,
        baseUrl: preset.baseUrl,
        icon: preset.icon,
        color: preset.color,
        models: preset.models,
        defaultModel: preset.models[0],
      });
      message.success(`已添加：${preset.name}`);
      onPicked();
    } catch {
      message.error('添加失败');
    }
  };

  return (
    <Modal title="从模板添加" open={open} onCancel={onCancel} footer={null} width={520}>
      <div className="grid grid-cols-2 gap-2" style={{ marginTop: 16 }}>
        {presets.map((p) => (
          <Button
            key={p.name}
            onClick={() => handlePick(p)}
            style={{ height: 'auto', padding: 12, textAlign: 'left' }}
          >
            <div style={{ fontWeight: 500 }}>{p.name}</div>
            <div style={{ fontSize: 11, color: 'var(--ant-color-text-tertiary)' }}>
              {p.models.length} 个模型 · {p.providerKind}
            </div>
          </Button>
        ))}
      </div>
    </Modal>
  );
}