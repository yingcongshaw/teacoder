import { Switch, Button, Tooltip } from 'antd';
import { EditOutlined, DeleteOutlined } from '@ant-design/icons';
import type { LlmProvider } from '../../../types';

interface Props {
  provider: LlmProvider;
  onEdit: (p: LlmProvider) => void;
  onDelete: (p: LlmProvider) => void;
  onToggleActive: (p: LlmProvider, checked: boolean) => void;
  onSetDefault: (providerId: string) => void;
}

/** LM Studio 专用 SVG 图标 */
function LmStudioIcon({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="6" fill="#1A1A1A"/>
      <path d="M8 10h16v2H10v10h12v2H8V10z" fill="#fff"/>
      <circle cx="20" cy="16" r="3" fill="#1A1A1A"/>
    </svg>
  );
}

/** 根据 icon 字段渲染图标 */
function ProviderIcon({ icon, name, color, size = 32 }: { icon: string | null; name: string; color: string | null; size?: number }) {
  if (icon === 'lmstudio') {
    return <LmStudioIcon size={size} />;
  }
  // 默认：首字母
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 6,
        background: color ?? 'var(--ant-color-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontWeight: 600,
        fontSize: size * 0.44,
      }}
    >
      {name.charAt(0)}
    </div>
  );
}

export default function LlmProviderCard({ provider, onEdit, onDelete, onToggleActive, onSetDefault }: Props) {
  return (
    <div
      style={{
        border: '1px solid var(--ant-color-border)',
        borderRadius: 8,
        padding: 16,
        background: provider.isActive ? 'var(--ant-color-bg-container)' : 'var(--ant-color-fill-quaternary)',
        opacity: provider.isActive ? 1 : 0.6,
        overflow: 'hidden',
      }}
    >
      <div className="flex items-start justify-between" style={{ marginBottom: 8, minWidth: 0 }}>
        <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
          <ProviderIcon icon={provider.icon} name={provider.name} color={provider.color} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{provider.name}</div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--ant-color-text-tertiary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: '100%',
              }}
            >
              {provider.baseUrl ?? '未设置 base_url'}
            </div>
          </div>
        </div>
        <div className="flex gap-1" style={{ flexShrink: 0 }}>
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

      <div className="flex items-center justify-between" style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--ant-color-border-secondary)' }}>
        <label
          style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer', color: provider.isDefault ? 'var(--ant-color-primary)' : 'var(--ant-color-text-secondary)' }}
          onClick={() => onSetDefault(provider.id)}
        >
          <input
            type="radio"
            checked={provider.isDefault}
            onChange={() => onSetDefault(provider.id)}
            style={{ cursor: 'pointer' }}
          />
          默认供应商
        </label>
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 11, color: provider.isActive ? 'var(--ant-color-text)' : 'var(--ant-color-text-tertiary)' }}>
            {provider.isActive ? '启用中' : '已停用'}
          </span>
          <Switch
            size="small"
            checked={provider.isActive}
            onChange={(checked) => onToggleActive(provider, checked)}
          />
        </div>
      </div>
    </div>
  );
}