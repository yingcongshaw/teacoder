import { useEffect } from "react";
import { Select, Tag } from "antd";
import { useAppStore } from "../../stores/appStore";
import { TOOL_PROVIDER_KIND_MAP } from "../../types";
import type { LlmProvider, ToolType } from "../../types";

interface Props {
  toolType: ToolType;
  value: {
    llmProviderIds?: string[];
    defaultLlmProviderId?: string;
  };
  onChange: (val: { llmProviderIds: string[]; defaultLlmProviderId?: string }) => void;
}

/**
 * 单一 CLI 工具的 LLM 供应商列表选择器：
 * - 多选：选择该 Profile 在当前 toolType 下可用的 LLM 供应商
 * - 单选：从已选供应商中选一个作为新建会话时的默认 LLM
 * 数据通过 store 加载，组件挂载时若为空则触发 loadLlmProviders。
 */
export default function CliArgsLlmList({ toolType, value, onChange }: Props) {
  const llmProviders = useAppStore((s) => s.llmProviders);
  const loadLlmProviders = useAppStore((s) => s.loadLlmProviders);

  useEffect(() => {
    if (llmProviders.length === 0) {
      loadLlmProviders();
    }
  }, [llmProviders.length, loadLlmProviders]);

  const allowedKinds = TOOL_PROVIDER_KIND_MAP[toolType] ?? [];
  const compatible = llmProviders.filter(
    (p) => p.isActive && allowedKinds.includes(p.providerKind),
  );

  const selectedIds = value.llmProviderIds ?? [];
  const defaultId = value.defaultLlmProviderId;

  return (
    <div className="space-y-3">
      <div>
        <div style={{ fontSize: 11, color: "var(--ant-color-text-secondary)", marginBottom: 4 }}>
          LLM 列表（多选）
        </div>
        <Select
          mode="multiple"
          size="small"
          style={{ width: "100%" }}
          placeholder="选择该 Profile 可用的 LLM 供应商"
          value={selectedIds}
          onChange={(ids) => {
            const newDefault = defaultId && ids.includes(defaultId) ? defaultId : undefined;
            onChange({ llmProviderIds: ids, defaultLlmProviderId: newDefault });
          }}
          options={compatible.map((p) => ({
            value: p.id,
            label: (
              <span>
                <Tag color={providerKindColor(p.providerKind)} style={{ marginRight: 4 }}>
                  {p.providerKind}
                </Tag>
                {p.name}
              </span>
            ),
          }))}
        />
      </div>

      <div>
        <div style={{ fontSize: 11, color: "var(--ant-color-text-secondary)", marginBottom: 4 }}>
          默认 LLM 供应商（单选）
        </div>
        <Select
          size="small"
          style={{ width: "100%" }}
          placeholder="选择新建会话时的默认 LLM"
          value={defaultId}
          allowClear
          onChange={(id) => onChange({ llmProviderIds: selectedIds, defaultLlmProviderId: id })}
          options={compatible
            .filter((p) => selectedIds.includes(p.id))
            .map((p) => {
              const defModel = p.models.find((m) => m.isDefault);
              return {
                value: p.id,
                label: (
                  <span>
                    <strong>{p.name}</strong>
                    {defModel && (
                      <span style={{ marginLeft: 6, color: "var(--ant-color-text-tertiary)" }}>
                        {defModel.modelName}
                      </span>
                    )}
                  </span>
                ),
              };
            })}
        />
      </div>
    </div>
  );
}

function providerKindColor(kind: LlmProvider["providerKind"]): string {
  return { anthropic: "orange", openai: "green", google: "blue", custom: "default" }[kind] ?? "default";
}
