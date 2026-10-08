import { Tag, Switch, Button, Tooltip } from 'antd';
import { EditOutlined, DeleteOutlined } from '@ant-design/icons';
import type { LlmProvider } from '../../../types';

interface Props {
  provider: LlmProvider;
  onEdit: (p: LlmProvider) => void;
  onDelete: (p: LlmProvider) => void;
  onToggleActive: (p: LlmProvider, checked: boolean) => void;
}

const KIND_COLORS: Record<string, string> = {
  anthropic: 'orange',
  openai: 'green',
  google: 'blue',
  custom: 'default',
};

export default function LlmProviderCard({ provider, onEdit, onDelete, onToggleActive }: Props) {
  const defaultModel = provider.models.find((m) => m.isDefault);

  return (
    <div
      style={{
        border: '1px solid var(--ant-color-border)',
        borderRadius: 8,
        padding: 16,
        background: provider.isActive ? 'var(--ant-color-bg-container)' : 'var(--ant-color-fill-quaternary)',
        opacity: provider.isActive ? 1 : 0.6,
      }}
    >
      <div className="flex items-start justify-between" style={{ marginBottom: 8 }}>
        <div className="flex items-center gap-2">
          {provider.icon && (
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 6,
                background: provider.color ?? 'var(--ant-color-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              {provider.name.charAt(0)}
            </div>
          )}
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{provider.name}</div>
            <div style={{ fontSize: 11, color: 'var(--ant-color-text-tertiary)' }}>
              {provider.baseUrl ?? '未设置 base_url'}
            </div>
          </div>
        </div>
        <div className="flex gap-1">
          <Tooltip title="编辑">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => onEdit(provider)}
            />
          </Tooltip>
          {!provider.isPreset && (
            <Tooltip title="删除">
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() => onDelete(provider)}
              />
            </Tooltip>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
        <Tag color={KIND_COLORS[provider.providerKind] ?? 'default'} style={{ fontSize: 11 }}>
          {provider.providerKind}
        </Tag>
        {provider.isPreset && (
          <Tag style={{ fontSize: 11 }}>预设</Tag>
        )}
        <span style={{ fontSize: 11, color: 'var(--ant-color-text-tertiary)' }}>
          {provider.models.length} 个模型
        </span>
      </div>

      {defaultModel && (
        <div style={{ fontSize: 11, color: 'var(--ant-color-text-tertiary)', marginBottom: 8 }}>
          默认模型：<span style={{ color: 'var(--ant-color-text)' }}>{defaultModel.modelName}</span>
        </div>
      )}

      <div className="flex items-center justify-between" style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--ant-color-border-secondary)' }}>
        <span style={{ fontSize: 11, color: 'var(--ant-color-text-tertiary)' }}>
          {provider.isActive ? '启用中' : '已停用'}
        </span>
        <Switch
          size="small"
          checked={provider.isActive}
          onChange={(checked) => onToggleActive(provider, checked)}
        />
      </div>
    </div>
  );
}