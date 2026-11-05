import { Select } from "antd";
import { useEffect } from "react";
import { useAppStore } from "../../stores/appStore";
import { DEV_KIND_CONFIGS } from "../../utils/devEnvKinds";

interface ProjectEnvSelectsProps {
  /** 项目绑定的开发环境 id 列表 */
  devEnvIds?: string[];
  onChange: (next: { devEnvIds: string[] }) => void;
}

/**
 * 项目的「运行环境」选择器。
 *
 * 选项来自「设置 - 开发环境」，按语言分组。一个项目可以同时绑多套环境
 * （比如 Java + Python），全部不绑就走系统默认环境。
 */
export default function ProjectEnvSelects({
  devEnvIds,
  onChange,
}: ProjectEnvSelectsProps) {
  const devEnvironments = useAppStore((s) => s.devEnvironments);
  const loadDevEnvironments = useAppStore((s) => s.loadDevEnvironments);

  useEffect(() => {
    if (devEnvironments.length === 0) {
      loadDevEnvironments().catch(() => {});
    }
  }, [devEnvironments.length]);

  const options = DEV_KIND_CONFIGS.map((config) => ({
    label: config.title,
    options: devEnvironments
      .filter((e) => e.kind === config.kind)
      .map((e) => ({ value: e.id, label: e.name })),
  })).filter((group) => group.options.length > 0);

  return (
    <div>
      <label className="block text-xs text-[var(--ant-color-text-secondary)] mb-1">
        开发环境（可多选）
      </label>
      <Select
        allowClear
        mode="multiple"
        className="w-full"
        placeholder="不绑定，使用系统默认"
        value={devEnvIds ?? []}
        onChange={(value) => onChange({ devEnvIds: value })}
        options={options}
        notFoundContent="还没有开发环境，去「设置 - 开发环境」添加"
        maxTagCount="responsive"
      />
    </div>
  );
}
