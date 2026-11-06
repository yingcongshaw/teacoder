import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Input, Select, App, Tag } from "antd";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../../stores/appStore";
import {
  devEnvironmentListForProject,
  serviceCreate,
  serviceEntryCandidates,
} from "../../utils/ipc";
import type { DevEnvironment, DevTool, ServiceCandidate } from "../../types";
import { DEV_KIND_CONFIGS, DEV_KIND_COLORS } from "../../utils/devEnvKinds";

/** 不依赖任何语言环境的自由命令服务。 */
const COMMAND_KIND = "command";

interface ServiceAddModalProps {
  open: boolean;
  onClose: () => void;
  /** 默认选中的项目 */
  defaultProjectId?: string;
  /** 是否允许切换项目（面板处于「所有项目」时需要） */
  allowProjectSelect?: boolean;
}

/** 工具的短名，用于环境摘要里显示。 */
const TOOL_LABELS: Record<string, string> = {
  jdk: "JDK",
  maven: "Maven",
  node: "Node",
  dotnet: ".NET",
  msbuild: "MSBuild",
  python: "Python",
  cargo: "Cargo",
  go: "Go",
  cmake: "CMake",
  cc: "编译器",
};

/** 一套环境的摘要：JDK 21.0.2 / Maven 3.9.11。 */
function envSummary(env: DevEnvironment): string {
  const parts = env.tools
    .map((tool: DevTool) => {
      const label = TOOL_LABELS[tool.tool] ?? tool.tool;
      return tool.version ? `${label} ${tool.version}` : label;
    })
    .filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : env.name;
}

/** 候选的唯一标识：同一类别下入口路径不重复。 */
function candidateKey(candidate: ServiceCandidate): string {
  return `${candidate.kind}:${candidate.path}`;
}

export default function ServiceAddModal({
  open,
  onClose,
  defaultProjectId,
  allowProjectSelect,
}: ServiceAddModalProps) {
  const { message } = App.useApp();
  const projects = useAppStore((s) => s.projects);

  const [projectId, setProjectId] = useState<string | undefined>(defaultProjectId);
  const [envs, setEnvs] = useState<DevEnvironment[]>([]);
  const [candidates, setCandidates] = useState<ServiceCandidate[]>([]);
  const [kind, setKind] = useState<string>(COMMAND_KIND);
  const [entryKey, setEntryKey] = useState<string | undefined>(undefined);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [buildCommand, setBuildCommand] = useState("");
  const [workingDir, setWorkingDir] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  /** 选中的入口决定了名称与命令，改入口就整体刷新。 */
  const applyCandidate = useCallback((candidate: ServiceCandidate | undefined) => {
    if (!candidate) {
      setEntryKey(undefined);
      setName("");
      setCommand("");
      setBuildCommand("");
      setWorkingDir("");
      return;
    }
    setEntryKey(candidateKey(candidate));
    setName(candidate.name);
    setCommand(candidate.command);
    setBuildCommand(candidate.buildCommand ?? "");
    setWorkingDir(candidate.workingDir);
  }, []);

  const resetForm = useCallback(() => {
    setKind(COMMAND_KIND);
    applyCandidate(undefined);
  }, [applyCandidate]);

  /** 载入项目绑定的环境与可运行入口。 */
  const loadContext = useCallback(
    async (pid: string | undefined) => {
      if (!pid) {
        setEnvs([]);
        setCandidates([]);
        return;
      }
      setLoading(true);
      try {
        const [envList, entryList] = await Promise.all([
          devEnvironmentListForProject(pid),
          serviceEntryCandidates(pid),
        ]);
        setEnvs(envList);
        setCandidates(entryList);
        // 有可运行入口就直接选上 —— 用户只改名字就能加服务
        const first = entryList[0];
        if (first) {
          setKind(first.kind);
          applyCandidate(first);
        }
      } catch (e) {
        message.error(`加载项目环境失败：${e}`);
      } finally {
        setLoading(false);
      }
    },
    [applyCandidate, message],
  );

  useEffect(() => {
    if (!open) return;
    setProjectId(defaultProjectId);
    resetForm();
    void loadContext(defaultProjectId);
  }, [open, defaultProjectId, resetForm, loadContext]);

  /** 项目切换后环境与入口都要跟着换。 */
  const handleProjectChange = (pid: string) => {
    setProjectId(pid);
    resetForm();
    void loadContext(pid);
  };

  const kindCandidates = useMemo(
    () => candidates.filter((c) => c.kind === kind),
    [candidates, kind],
  );

  const selectedCandidate = useMemo(
    () => kindCandidates.find((c) => candidateKey(c) === entryKey),
    [kindCandidates, entryKey],
  );

  /** 环境类别只能选项目绑定过的那些。 */
  const kindOptions = useMemo(() => {
    const boundKinds = Array.from(new Set(envs.map((e) => e.kind)));
    return DEV_KIND_CONFIGS.filter((c) => boundKinds.includes(c.kind)).map((c) => ({
      value: c.kind,
      label: c.title,
    }));
  }, [envs]);

  const handleKindChange = (next: string) => {
    setKind(next);
    const first = candidates.find((c) => c.kind === next);
    applyCandidate(first);
  };

  const browse = async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (selected && typeof selected === "string") {
      setWorkingDir(selected);
    }
  };

  /** 当前类别下已绑定的环境摘要，展示给用户确认版本。 */
  const kindEnv = envs.find((e) => e.kind === kind);

  const handleOk = async () => {
    if (!projectId) {
      message.warning("请选择所属项目");
      return;
    }
    if (!name.trim()) {
      message.warning("请输入服务名称");
      return;
    }
    if (!command.trim()) {
      message.warning("请输入启动命令");
      return;
    }
    setSaving(true);
    try {
      await serviceCreate({
        projectId,
        name: name.trim(),
        kind: selectedCandidate?.kind ?? kind,
        command: command.trim(),
        buildCommand: buildCommand.trim() || undefined,
        workingDir: workingDir.trim() || undefined,
        artifactId: selectedCandidate?.artifactId,
        artifactDir: selectedCandidate?.artifactDir,
        mainClass: selectedCandidate?.mainClass,
      });
      message.success("服务已添加");
      onClose();
    } catch (e) {
      message.error(`添加失败：${e}`);
    } finally {
      setSaving(false);
    }
  };

  /** 选了入口后命令由环境推导，不再让用户改。 */
  const commandLocked = !!selectedCandidate;

  return (
    <Modal
      title="添加服务"
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      okText="添加"
      cancelText="取消"
      confirmLoading={saving}
      width={560}
      destroyOnHidden
    >
      <div className="space-y-4 mt-2">
        {allowProjectSelect && (
          <div>
            <label className="block text-xs text-[var(--ant-color-text-secondary)] mb-1">所属项目</label>
            <Select
              className="w-full"
              placeholder="选择项目"
              value={projectId}
              onChange={handleProjectChange}
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
            />
          </div>
        )}

        {kindOptions.length === 0 && (
          <div
            className="text-xs px-3 py-2 rounded"
            style={{
              backgroundColor: "var(--ant-color-fill-quaternary)",
              color: "var(--ant-color-text-secondary)",
            }}
          >
            该项目没有绑定开发/运行环境，无法按语言环境添加服务。请先在「项目设置 - 开发/运行环境」里绑定，或选择下面的「命令行 / 脚本」。
          </div>
        )}

        <div>
          <label className="block text-xs text-[var(--ant-color-text-secondary)] mb-1">环境类型</label>
          <Select
            className="w-full"
            value={kind}
            onChange={handleKindChange}
            loading={loading}
            options={[...kindOptions, { value: COMMAND_KIND, label: "命令行 / 脚本" }]}
          />
          <div className="text-xs text-[var(--ant-color-text-tertiary)] mt-1">
            只能选该项目已绑定开发/运行环境的服务类型
          </div>
        </div>

        {kindEnv && (
          <div className="text-xs text-[var(--ant-color-text-tertiary)]">
            使用环境：
            <Tag className="ml-1" color={DEV_KIND_COLORS[kindEnv.kind]}>
              {envSummary(kindEnv)}
            </Tag>
            运行时与构建都用这套环境，不会用到系统里的其它版本
          </div>
        )}

        {kind !== COMMAND_KIND && kindCandidates.length > 0 && (
          <div>
            <label className="block text-xs text-[var(--ant-color-text-secondary)] mb-1">启动入口</label>
            <Select
              className="w-full"
              value={entryKey}
              onChange={(value) => {
                const candidate = kindCandidates.find((c) => candidateKey(c) === value);
                applyCandidate(candidate);
              }}
              placeholder="选择要启动的入口"
              options={kindCandidates.map((c) => ({
                value: candidateKey(c),
                label: (
                  <div className="flex items-center justify-between gap-2 min-w-0">
                    <span className="truncate">{c.name}</span>
                    <span className="text-xs text-[var(--ant-color-text-tertiary)] truncate">
                      {c.path}
                    </span>
                  </div>
                ),
              }))}
            />
          </div>
        )}

        {kind !== COMMAND_KIND && kindCandidates.length === 0 && (
          <div className="text-xs text-[var(--ant-color-text-tertiary)]">
            该类别下没有识别到可运行的工程，可改用下面的命令自行填写。
          </div>
        )}

        <div>
          <label className="block text-xs text-[var(--ant-color-text-secondary)] mb-1">服务名称</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={selectedCandidate ? "默认取入口名，可自行修改" : "例如：用户服务"}
          />
        </div>

        <div>
          <label className="block text-xs text-[var(--ant-color-text-secondary)] mb-1">启动命令</label>
          <Input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            disabled={commandLocked}
            placeholder="例如：mvn spring-boot:run"
          />
          <div className="text-xs text-[var(--ant-color-text-tertiary)] mt-1">
            {commandLocked
              ? "由所选入口与环境推导"
              : "不带 shell 语法，不支持管道与重定向"}
          </div>
        </div>

        <div>
          <label className="block text-xs text-[var(--ant-color-text-secondary)] mb-1">构建命令</label>
          <Input
            value={buildCommand}
            onChange={(e) => setBuildCommand(e.target.value)}
            disabled={commandLocked}
            placeholder="例如：cmake -S . -B build"
          />
          <div className="text-xs text-[var(--ant-color-text-tertiary)] mt-1">
            {commandLocked
              ? "由所选入口推导"
              : "可选。启动前先执行一次，构建失败则不启动服务"}
          </div>
        </div>

        <div>
          <label className="block text-xs text-[var(--ant-color-text-secondary)] mb-1">工作目录</label>
          <Input
            value={workingDir}
            onChange={(e) => setWorkingDir(e.target.value)}
            disabled={commandLocked}
            placeholder="留空则用项目路径"
            addonAfter={
              commandLocked ? undefined : (
                <span
                  className="cursor-pointer text-xs text-[var(--ant-color-primary)]"
                  onClick={browse}
                >
                  浏览
                </span>
              )
            }
          />
        </div>
      </div>
    </Modal>
  );
}
