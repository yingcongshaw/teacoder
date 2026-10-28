import { useState, useEffect } from 'react';
import { Modal, Form, Input, Select, Button, App, AutoComplete, ColorPicker } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import type { LlmProvider, AuthType } from '../../../types';
import { useAppStore } from '../../../stores/appStore';
import { listLlmProviderPresets } from '../../../utils/ipc';

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

const AUTH_TYPES = [
  { value: 'api_key', label: 'API Key' },
  { value: 'oauth', label: 'OAuth Token' },
];

/** 只有标准 6 位 hex 能喂给取色器，脏数据一律当作未设置 */
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** ColorPicker 回传对象上我们只用到 hex 序列化 */
type PickedColor = { toHexString: () => string };

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
  const [authType, setAuthType] = useState<AuthType>('api_key');
  const [apiKey, setApiKey] = useState('');
  const [apiKeyTouched, setApiKeyTouched] = useState(false);
  const [hasExistingApiKey, setHasExistingApiKey] = useState(false);
  const [oauthToken, setOauthToken] = useState('');
  const [oauthTokenTouched, setOauthTokenTouched] = useState(false);
  const [hasExistingOauthToken, setHasExistingOauthToken] = useState(false);
  const [saving, setSaving] = useState(false);
  // 图标名候选项取自内置模板：模板里的图标名是应用已知的全部取值
  const [iconOptions, setIconOptions] = useState<{ value: string; label: string }[]>([]);

  useEffect(() => {
    if (!open) return;
    listLlmProviderPresets()
      .then((presets) => {
        const byIcon = new Map<string, string>();
        for (const p of presets) {
          if (p.icon && !byIcon.has(p.icon)) byIcon.set(p.icon, p.name);
        }
        setIconOptions(
          [...byIcon.entries()].map(([value, name]) => ({ value, label: `${name}（${value}）` })),
        );
      })
      .catch(() => setIconOptions([]));
  }, [open]);

  useEffect(() => {
    if (open) {
      if (provider) {
        form.setFieldsValue({
          name: provider.name,
          providerKind: provider.providerKind,
          authType: provider.authType,
          baseUrl: provider.baseUrl ?? '',
          icon: provider.icon ?? '',
          color:
            provider.color && HEX_COLOR_RE.test(provider.color)
              ? provider.color
              : undefined,
        });
        setModels(provider.models.map((m) => m.modelName));
        const def = provider.models.find((m) => m.isDefault);
        setDefaultModel(def?.modelName ?? null);
        setAuthType(provider.authType);
        setApiKey('');
        setApiKeyTouched(false);
        setHasExistingApiKey(false);
        setOauthToken('');
        setOauthTokenTouched(false);
        setHasExistingOauthToken(false);
        // 从 provider.apiKey / oauthToken 获取实际值用于回显（不是掩码）
        if (provider.apiKey) {
          setHasExistingApiKey(true);
          setApiKey(provider.apiKey);
        }
        if (provider.oauthToken) {
          setHasExistingOauthToken(true);
          setOauthToken(provider.oauthToken);
        }
      } else {
        form.resetFields();
        setModels([]);
        setDefaultModel(null);
        setAuthType('api_key');
        setApiKey('');
        setApiKeyTouched(false);
        setHasExistingApiKey(false);
        setOauthToken('');
        setOauthTokenTouched(false);
        setHasExistingOauthToken(false);
      }
    }
  }, [open, provider, form]);

  const handleAuthTypeChange = (value: AuthType) => {
    setAuthType(value);
    // 切换认证方式时清除敏感字段
    setApiKey('');
    setApiKeyTouched(false);
    setHasExistingApiKey(false);
    setOauthToken('');
    setOauthTokenTouched(false);
    setHasExistingOauthToken(false);
  };

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
        const apiKeyValue = apiKeyTouched ? (apiKey || '') : undefined;
        const oauthTokenValue = oauthTokenTouched ? (oauthToken || '') : undefined;
        const updateInput = {
          name: values.name,
          providerKind: values.providerKind,
          authType: values.authType,
          baseUrl: values.baseUrl || undefined,
          icon: values.icon || undefined,
          color: values.color || undefined,
          models: cleanedModels,
          defaultModel: effectiveDefault,
          apiKey: apiKeyValue,
          oauthToken: oauthTokenValue,
        };
        try {
          await updateStore(provider.id, updateInput);
          message.success('已更新');
        } catch (err) {
          message.error('保存失败: ' + String(err));
          setSaving(false);
          return;
        }
      } else {
        await createStore({
          name: values.name,
          providerKind: values.providerKind,
          authType: values.authType,
          baseUrl: values.baseUrl || undefined,
          icon: values.icon || undefined,
          color: values.color || undefined,
          models: cleanedModels,
          defaultModel: effectiveDefault,
          apiKey: authType === 'api_key' ? (apiKey || undefined) : undefined,
          oauthToken: authType === 'oauth' ? (oauthToken || undefined) : undefined,
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
        <div className="grid grid-cols-2 gap-3">
          <Form.Item name="providerKind" label="协议类型" rules={[{ required: true }]}>
            <Select options={PROVIDER_KINDS} placeholder="选择协议类型" />
          </Form.Item>
          <Form.Item name="authType" label="认证方式" rules={[{ required: true }]}>
            <Select
              options={AUTH_TYPES}
              placeholder="选择认证方式"
              onChange={handleAuthTypeChange}
            />
          </Form.Item>
        </div>
        <Form.Item name="baseUrl" label="Base URL">
          <Input placeholder="https://api.example.com/v1" />
        </Form.Item>

        {authType === 'api_key' ? (
          <Form.Item label={hasExistingApiKey ? 'API Key（已设置）' : 'API Key'}>
            <Input.Password
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setApiKeyTouched(true);
              }}
              placeholder={hasExistingApiKey ? '留空保持原值，填写则覆盖' : '请输入 API Key'}
            />
          </Form.Item>
        ) : (
          <Form.Item label={hasExistingOauthToken ? 'OAuth Token（已设置）' : 'OAuth Token'}>
            <Input.Password
              value={oauthToken}
              onChange={(e) => {
                setOauthToken(e.target.value);
                setOauthTokenTouched(true);
              }}
              placeholder={hasExistingOauthToken ? '留空保持原值，填写则覆盖' : '请输入 OAuth Token'}
            />
          </Form.Item>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Form.Item name="icon" label="图标名">
            <AutoComplete
              options={iconOptions}
              placeholder="anthropic"
              filterOption={(input, option) =>
                String(option?.value ?? '')
                  .toLowerCase()
                  .includes(input.toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item
            name="color"
            label="颜色"
            getValueFromEvent={(color: PickedColor) => color.toHexString()}
          >
            <ColorPicker showText format="hex" />
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