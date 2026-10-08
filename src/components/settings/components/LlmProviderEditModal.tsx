import { useState, useEffect } from 'react';
import { Modal, Form, Input, Select, Button, App } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import type { LlmProvider } from '../../../types';
import { useAppStore } from '../../../stores/appStore';

interface Props {
  open: boolean;
  provider?: LlmProvider;
  onCancel: () => void;
  onSaved: () => void;
}

const PROVIDER_KINDS = [
  { value: 'anthropic', label: 'Anthropic 协议' },
  { value: 'openai', label: 'OpenAI 协议' },
  { value: 'google', label: 'Google 协议' },
  { value: 'custom', label: '自定义' },
];

/**
 * LlmProvider 编辑模态框：新建或编辑一个 LLM 供应商配置。
 * 通过 store 的 createLlmProvider / updateLlmProvider 触发保存，
 * store thunks 内部已封装 IPC 调用与 loadLlmProviders 重载。
 */
export default function LlmProviderEditModal({ open, provider, onCancel, onSaved }: Props) {
  const { message } = App.useApp();
  const updateStore = useAppStore((s) => s.updateLlmProvider);
  const createStore = useAppStore((s) => s.createLlmProvider);

  const [form] = Form.useForm();
  const [models, setModels] = useState<string[]>([]);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (provider) {
        form.setFieldsValue({
          name: provider.name,
          providerKind: provider.providerKind,
          baseUrl: provider.baseUrl ?? '',
          icon: provider.icon ?? '',
          color: provider.color ?? '',
        });
        setModels(provider.models.map((m) => m.modelName));
        const def = provider.models.find((m) => m.isDefault);
        setDefaultModel(def?.modelName ?? null);
        setApiKey('');
      } else {
        form.resetFields();
        setModels([]);
        setDefaultModel(null);
        setApiKey('');
      }
    }
  }, [open, provider, form]);

  const handleAddModel = () => {
    setModels([...models, '']);
  };

  const handleRemoveModel = (idx: number) => {
    const removed = models[idx];
    const next = models.filter((_, i) => i !== idx);
    setModels(next);
    if (defaultModel === removed) setDefaultModel(null);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const cleanedModels = models.map((m) => m.trim()).filter(Boolean);
      if (cleanedModels.length === 0) {
        message.warning('请至少添加一个模型');
        return;
      }
      const effectiveDefault = defaultModel && cleanedModels.includes(defaultModel)
        ? defaultModel
        : cleanedModels[0];

      setSaving(true);
      if (provider) {
        await updateStore(provider.id, {
          name: values.name,
          providerKind: values.providerKind,
          baseUrl: values.baseUrl || undefined,
          icon: values.icon || undefined,
          color: values.color || undefined,
          models: cleanedModels,
          defaultModel: effectiveDefault,
          apiKey: apiKey || undefined,
        });
        message.success('已更新');
      } else {
        await createStore({
          name: values.name,
          providerKind: values.providerKind,
          baseUrl: values.baseUrl || undefined,
          icon: values.icon || undefined,
          color: values.color || undefined,
          models: cleanedModels,
          defaultModel: effectiveDefault,
          apiKey: apiKey || undefined,
        });
        message.success('已创建');
      }
      onSaved();
      onCancel();
    } catch (err) {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={provider ? `编辑供应商：${provider.name}` : '新建供应商'}
      open={open}
      onCancel={onCancel}
      onOk={handleSave}
      confirmLoading={saving}
      width={560}
      okText="保存"
      cancelText="取消"
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
          <Input placeholder="例如：Anthropic、GLM 智谱" />
        </Form.Item>
        <Form.Item name="providerKind" label="协议类型" rules={[{ required: true }]}>
          <Select options={PROVIDER_KINDS} placeholder="选择协议类型" />
        </Form.Item>
        <Form.Item name="baseUrl" label="Base URL">
          <Input placeholder="https://api.example.com/v1" />
        </Form.Item>
        <Form.Item label="API Key">
          <Input.Password
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={provider ? '留空保持原值' : '请输入 API Key'}
          />
        </Form.Item>
        <div className="grid grid-cols-2 gap-3">
          <Form.Item name="icon" label="图标名">
            <Input placeholder="anthropic" />
          </Form.Item>
          <Form.Item name="color" label="颜色（hex）">
            <Input placeholder="#D97757" />
          </Form.Item>
        </div>
      </Form>

      <div style={{ marginTop: 8, marginBottom: 8 }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>模型列表</span>
          <Button size="small" icon={<PlusOutlined />} onClick={handleAddModel}>
            添加模型
          </Button>
        </div>
        {models.map((m, idx) => (
          <div key={idx} className="flex items-center gap-2" style={{ marginBottom: 6 }}>
            <Input
              value={m}
              size="small"
              placeholder="model-id"
              style={{ flex: 1 }}
              onChange={(e) => {
                const next = [...models];
                next[idx] = e.target.value;
                setModels(next);
              }}
            />
            <input
              type="radio"
              checked={defaultModel === m && m !== ''}
              disabled={!m}
              onChange={() => setDefaultModel(m)}
            />
            <Button
              size="small"
              type="text"
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleRemoveModel(idx)}
            />
          </div>
        ))}
        <div style={{ fontSize: 11, color: 'var(--ant-color-text-tertiary)' }}>
          选中单选按钮标记默认模型
        </div>
      </div>
    </Modal>
  );
}