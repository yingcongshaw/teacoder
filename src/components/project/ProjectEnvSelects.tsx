import { Select } from "antd";
import { useEffect, useMemo } from "react";
import { useAppStore } from "../../stores/appStore";
import { DEV_KIND_CONFIGS } from "../../utils/devEnvKinds";

interface ProjectEnvSelectsProps {
  /** 项目绑定的开发环境 id 列表 */
  devEnvIds?: string[];
  onChange: (next: { devEnvIds: string[] }) => void;
}

/**
 * 一个环境类别（Java / Node / …）里最多只能选一套。
 * 同类别出现多项时保留列表里靠后的那项 —— 新选的那套排在后面，
 * 所以后选的自然顶掉先选的。
 */
function dedupeByKind(
  ids: string[],
  kindOf: (id: string) => string | undefined,
): string[] {
  const lastOfKind = new Map<string, number>();
  ids.forEach((id, index) => {
    const kind = kindOf(id);
    if (kind) lastOfKind.set(kind, index);
  });
  return ids.filter((id, index) => {
    const kind = kindOf(id);
    if (!kind) return true;
    return lastOfKind.get(kind) === index;
  });
}

/**
 * 项目的「开发/运行环境」选择器。
 *
 * 选项来自「设置 - 开发环境」，按语言分组。一个项目可以同时绑多套环境
 * （比如 Java + Python），全部不绑就走系统默认环境。同一个语言下只能选一套，
 * 新选的那套会顶掉同类别已选的那套。
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

  const kindOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const env of devEnvironments) map.set(env.id, env.kind);
    return (id: string) => map.get(id);
  }, [devEnvironments]);

  const options = DEV_KIND_CONFIGS.map((config) => ({
    label: config.title,
    options: devEnvironments
      .filter((e) => e.kind === config.kind)
      .map((e) => ({ value: e.id, label: e.name })),
  })).filter((group) => group.options.length > 0);

  const selected = useMemo(
    () => dedupeByKind(devEnvIds ?? [], kindOf),
    [devEnvIds, kindOf],
  );

  const handleChange = (next: string[]) => {
    onChange({ devEnvIds: dedupeByKind(next, kindOf) });
  };

  return (
    <div>
      <label className="block text-xs text-[var(--ant-color-text-secondary)] mb-1">
        开发/运行环境（每类环境只能选一套）
      </label>
      <Select
        allowClear
        mode="multiple"
        className="w-full"
        placeholder="不绑定，使用系统默认"
        value={selected}
        onChange={handleChange}
        options={options}
        notFoundContent="还没有开发环境，去「设置 - 开发环境」添加"
        maxTagCount="responsive"
      />
    </div>
  );
}
