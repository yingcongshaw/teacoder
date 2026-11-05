import { Select } from "antd";
import { useEffect } from "react";
import { useAppStore } from "../../stores/appStore";

interface ProjectEnvSelectsProps {
  javaEnvId?: string;
  nodeEnvId?: string;
  onChange: (next: { javaEnvId?: string; nodeEnvId?: string }) => void;
}

/**
 * 项目的「运行环境」选择器。
 *
 * 选项来自「设置 - 开发环境」。清空表示不绑定 —— 会话与服务都走系统默认环境。
 */
export default function ProjectEnvSelects({
  javaEnvId,
  nodeEnvId,
  onChange,
}: ProjectEnvSelectsProps) {
  const devEnvironments = useAppStore((s) => s.devEnvironments);
  const loadDevEnvironments = useAppStore((s) => s.loadDevEnvironments);

  useEffect(() => {
    if (devEnvironments.length === 0) {
      loadDevEnvironments().catch(() => {});
    }
  }, [devEnvironments.length]);

  const javaOptions = devEnvironments.filter((e) => e.kind === "java");
  const nodeOptions = devEnvironments.filter((e) => e.kind === "node");

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs text-[var(--ant-color-text-secondary)] mb-1">
          Java 环境（JDK / Maven）
        </label>
        <Select
          allowClear
          className="w-full"
          placeholder="不绑定，使用系统默认"
          value={javaEnvId || undefined}
          onChange={(value) => onChange({ javaEnvId: value, nodeEnvId })}
          options={javaOptions.map((e) => ({
            value: e.id,
            label: e.name,
          }))}
          notFoundContent="还没有 Java 环境，去「设置 - 开发环境」添加"
        />
      </div>
      <div>
        <label className="block text-xs text-[var(--ant-color-text-secondary)] mb-1">
          Node 环境
        </label>
        <Select
          allowClear
          className="w-full"
          placeholder="不绑定，使用系统默认"
          value={nodeEnvId || undefined}
          onChange={(value) => onChange({ javaEnvId, nodeEnvId: value })}
          options={nodeOptions.map((e) => ({
            value: e.id,
            label: e.name,
          }))}
          notFoundContent="还没有 Node 环境，去「设置 - 开发环境」添加"
        />
      </div>
    </div>
  );
}
