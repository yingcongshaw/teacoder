import { useState, useEffect, useRef } from "react";
import { Input, Select, Tooltip, App, Checkbox } from "antd";
import { useAppStore } from "../../stores/appStore";
import { detectCliTools, testSshConnection, getToolSettings } from "../../utils/ipc";
import { CLAUDE_TIER_ENTRIES } from "../../utils/claudeModels";
import { BUILTIN_SESSION_TEMPLATES, TOOL_PROVIDER_KIND_MAP } from "../../types";
import type { ToolType, CliTool, LlmProvider, SshArgs } from "../../types";
import { EMPTY_SSH_ARGS, serializeSshArgs } from "../../utils/sshArgs";
import { CLI_TOOLS, sortCliToolsByAvailability, isCliToolAvailable, type CliToolMeta } from "../cli/cliTools";
import CliArgsClaude from "../cli/CliArgsClaude";
import SshArgsFields from "../cli/SshArgsFields";

interface NewSessionModalProps {
  open: boolean;
  projectId: string | null;
  categoryId?: string | null;
  onClose: () => void;
}

const COLOR_PRESETS = [
  "#722ed1", "#1890ff", "#1677ff", "#fa8c16",
  "#52c41a", "#13c2c2", "#eb2f96", "#ff4d4f",
];


function buildCliArgs(toolType: ToolType, params: Record<string, unknown>): string {
  const args: string[] = [];

  if (toolType === "claude") {
    if (params.dangerouslySkipPermissions) args.push("--dangerously-skip-permissions");
    if (params.verbose) args.push("--verbose");
    if (params.maxTurns) args.push("--max-turns", String(params.maxTurns));
    if (params.appendSystemPrompt) args.push("--append-system-prompt", String(params.appendSystemPrompt));
    if (params.mcpConfig) args.push("--mcp-config", String(params.mcpConfig));
    const allowed = params.allowedTools as string[] | undefined;
    if (allowed?.length) args.push("--allowedTools", allowed.join(","));
    const disallowed = params.disallowedTools as string[] | undefined;
    if (disallowed?.length) args.push("--disallowedTools", disallowed.join(","));
  }

  return args.length > 0 ? JSON.stringify(args) : "";
}

function buildDefaultClaudeModels(provider: LlmProvider) {
  const defModel =
    provider.models.find((m) => m.isDefault)?.modelName ??
    provider.models[0]?.modelName;
  if (!defModel) return {};
  return {
    sonnet: defModel,
    opus: defModel,
    haiku: defModel,
    fable: defModel,
    subagent: defModel,
  };
}

export default function NewSessionModal({ open: isOpen, projectId, categoryId, onClose }: NewSessionModalProps) {
  const { message } = App.useApp();
  const createSession = useAppStore((s) => s.createSession);
  const cliTools = useAppStore((s) => s.cliTools);
  const setCliTools = useAppStore((s) => s.setCliTools);
  const globalThinkingIntensity = useAppStore((s) => s.globalThinkingIntensity);
  const projects = useAppStore((s) => s.projects);
  const categories = useAppStore((s) => s.categories);
  const llmProviders = useAppStore((s) => s.llmProviders);
  const loadLlmProviders = useAppStore((s) => s.loadLlmProviders);

  const [selectedTool, setSelectedTool] = useState<ToolType | null>(null);
  const [selectedColor, setSelectedColor] = useState<string>(COLOR_PRESETS[0]);
  const [title, setTitle] = useState("");
  const [profileId, setProfileId] = useState<string | undefined>();
  const [thinkingIntensity, setThinkingIntensity] = useState(globalThinkingIntensity);
  const [templateId, setTemplateId] = useState<string | undefined>();
  const [envVars, setEnvVars] = useState("");
  const [cliParams, setCliParams] = useState<Record<string, unknown>>({});
  const [sessionCategoryId, setSessionCategoryId] = useState<string | undefined>(undefined);
  const [llmProviderId, setLlmProviderId] = useState<string | undefined>();
  const [modelName, setModelName] = useState<string | undefined>();
  // For Claude Code: per-tier model mapping (含 1M 标记)
  const [claudeModels, setClaudeModels] = useState<{
    sonnet?: string;
    opus?: string;
    haiku?: string;
    fable?: string;
    subagent?: string;
    sonnet1M?: boolean;
    opus1M?: boolean;
    haiku1M?: boolean;
    fable1M?: boolean;
    subagent1M?: boolean;
  }>({});
  const [profileLlmDefaults, setProfileLlmDefaults] = useState<{ defaultLlmProviderId?: string }>({});

  const [sshArgs, setSshArgs] = useState<SshArgs>(EMPTY_SSH_ARGS);
  const [testingConnection, setTestingConnection] = useState(false);

  const project = projects.find((p) => p.id === projectId);
  const filteredCategories = projectId
    ? categories.filter((c) => c.projectId === projectId)
    : [];

  const modalRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, input, select, textarea, label")) return;
    setIsDragging(true);
    setDragOffset({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging || !modalRef.current) return;
    const dx = e.clientX - dragOffset.x;
    const dy = e.clientY - dragOffset.y;
    modalRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
  };

  const handleMouseUp = (e: MouseEvent) => {
    if (!isDragging) return;
    if (modalRef.current) {
      const dx = e.clientX - dragOffset.x;
      const dy = e.clientY - dragOffset.y;
      const rect = modalRef.current.getBoundingClientRect();
      modalRef.current.style.transform = "none";
      modalRef.current.style.left = `${rect.left + dx}px`;
      modalRef.current.style.top = `${rect.top + dy}px`;
      modalRef.current.style.bottom = "auto";
    }
    setIsDragging(false);
    setDragOffset({ x: e.clientX, y: e.clientY });
  };

  useEffect(() => {
    if (isOpen && cliTools.length === 0) {
      detectCliTools().then(setCliTools).catch(() => {});
    }
  }, [isOpen, cliTools.length, setCliTools]);

  useEffect(() => {
    if (isOpen && llmProviders.length === 0) {
      loadLlmProviders().catch(() => {});
    }
  }, [isOpen, llmProviders.length, loadLlmProviders]);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  useEffect(() => {
    if (isOpen) {
      setSelectedTool(null);
      setSelectedColor(project?.color || COLOR_PRESETS[0]);
      setTitle("");
      setProfileId(undefined);
      setThinkingIntensity(globalThinkingIntensity);
      setTemplateId(undefined);
      setEnvVars("");
      setCliParams({});
      setSshArgs(EMPTY_SSH_ARGS);
      setSessionCategoryId(categoryId || undefined);
      setLlmProviderId(undefined);
      setModelName(undefined);
      setClaudeModels({});
      setProfileLlmDefaults({});
    }
  }, [isOpen, globalThinkingIntensity, categoryId, project?.color]);

  // 选中分类时颜色标记继承自分类；未选中时跟随项目颜色
  useEffect(() => {
    if (!isOpen) return;
    if (sessionCategoryId) {
      const cat = categories.find((c) => c.id === sessionCategoryId);
      if (cat?.color) setSelectedColor(cat.color);
    } else if (project?.color) {
      setSelectedColor(project.color);
    }
  }, [isOpen, sessionCategoryId, project?.color, categories]);

  useEffect(() => {
    if (!profileId) {
      setProfileLlmDefaults({});
      return;
    }
    let cancelled = false;
    getToolSettings(profileId)
      .then((toolSettings) => {
        if (cancelled) return;
        if (!toolSettings?.settingsJson) {
          setProfileLlmDefaults({});
          return;
        }
        try {
          const parsed = JSON.parse(toolSettings.settingsJson);
          setProfileLlmDefaults({
            defaultLlmProviderId: typeof parsed.defaultLlmProviderId === "string" ? parsed.defaultLlmProviderId : undefined,
          });
        } catch {
          setProfileLlmDefaults({});
        }
      })
      .catch(() => {
        if (!cancelled) setProfileLlmDefaults({});
      });
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  useEffect(() => {
    const defId = profileLlmDefaults.defaultLlmProviderId;
    if (!defId) {
      // Fall back to global default provider
      const globalDefProvider = llmProviders.find((p) => p.isDefault && p.isActive);
      if (
        globalDefProvider &&
        compatibleProviders(selectedTool).some((cp) => cp.id === globalDefProvider.id)
      ) {
        setLlmProviderId(globalDefProvider.id);
        if (selectedTool === "claude") {
          setClaudeModels(buildDefaultClaudeModels(globalDefProvider));
        } else {
          const defModel = globalDefProvider.models.find((m) => m.isDefault);
          setModelName(defModel?.modelName);
        }
      } else {
        setLlmProviderId(undefined);
        setModelName(undefined);
      }
      return;
    }
    const provider = llmProviders.find((p) => p.id === defId);
    if (!provider || !provider.isActive) return;
    setLlmProviderId(defId);
    if (selectedTool === "claude") {
      setClaudeModels(buildDefaultClaudeModels(provider));
    } else {
      const defModel = provider.models.find((m) => m.isDefault);
      setModelName(defModel?.modelName);
    }
  }, [profileLlmDefaults.defaultLlmProviderId, llmProviders, selectedTool]);

  // Clear claudeModels when switching away from claude tool
  useEffect(() => {
    if (selectedTool !== "claude") {
      setClaudeModels({});
    }
  }, [selectedTool]);

  const sortedTools = sortCliToolsByAvailability(CLI_TOOLS, cliTools);

  const getToolInfo = (toolType: ToolType): CliTool | undefined =>
    cliTools.find((t) => t.toolType === toolType);

  const buildSshArgs = (): string => serializeSshArgs(sshArgs);

  const compatibleProviders = (toolType: ToolType | null): LlmProvider[] => {
    if (!toolType) return [];
    const allowedKinds = TOOL_PROVIDER_KIND_MAP[toolType] ?? [];
    return llmProviders.filter(
      (p) => p.isActive && allowedKinds.includes(p.providerKind),
    );
  };

  const handleTestSsh = async () => {
    if (!sshArgs.hostname.trim()) {
      message.warning("请填写主机名");
      return;
    }
    setTestingConnection(true);
    try {
      const result = await testSshConnection({
        hostname: sshArgs.hostname,
        port: sshArgs.port,
        username: sshArgs.username,
        password: sshArgs.password || undefined,
        identity_file: sshArgs.identityFile || undefined,
      });
      message.success(result);
    } catch (err) {
      message.error(`连接失败: ${err}`);
    } finally {
      setTestingConnection(false);
    }
  };

  const handleOk = async () => {
    if (!selectedTool) {
      message.warning("请选择 CLI 工具");
      return;
    }
    if (!projectId) {
      message.warning("请先创建或选择项目");
      return;
    }
    if (selectedTool === "ssh" && !sshArgs.hostname.trim()) {
      message.warning("请填写主机名");
      return;
    }

    const finalCliArgs =
      selectedTool === "ssh"
        ? buildSshArgs()
        : buildCliArgs(selectedTool, cliParams) || undefined;

    try {
      await createSession({
        projectId,
        toolType: selectedTool,
        title: title.trim() || undefined,
        profileId,
        color: selectedColor,
        thinkingIntensity,
        templateId,
        cliArgs: finalCliArgs,
        envVars: envVars.trim() || undefined,
        categoryId: sessionCategoryId,
        llmProviderId,
        modelName,
        // store 边界处统一序列化为字符串；Modal 始终以对象形态操作
        claudeModels: selectedTool === "claude" ? claudeModels : undefined,
      });
      onClose();
    } catch (err) {
      message.error(`创建会话失败: ${err}`);
    }
  };

  const handleCancel = () => {
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.45)", zIndex: 1000 }}
    >
      <div
        ref={modalRef}
        className="new-session-modal flex flex-col overflow-hidden"
        style={{
          width: 480,
          maxHeight: "90vh",
          backgroundColor: "var(--ant-color-bg-layout)",
          border: "1px solid var(--ant-color-border-secondary)",
          borderRadius: 12,
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          cursor: isDragging ? "grabbing" : "default",
        }}
      >
        <div
          className="flex items-center justify-between px-5 py-3"
          style={{ borderBottom: "1px solid var(--ant-color-border-secondary)", cursor: "grab" }}
          onMouseDown={handleMouseDown}
        >
          <h3 className="text-base font-medium m-0" style={{ color: "var(--ant-color-text)" }}>
            新建会话
            {project && (
              <span className="text-xs text-[var(--ant-color-text-tertiary)] ml-2">— {project.name}</span>
            )}
          </h3>
          <button
            onClick={handleCancel}
            className="text-lg leading-none cursor-pointer"
            style={{ background: "none", border: "none", color: "var(--ant-color-text-tertiary)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--ant-color-text)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--ant-color-text-tertiary)")}
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 12, color: "var(--ant-color-text-secondary)", marginBottom: 4 }}>所属分类</label>
            <Select
              size="small"
              placeholder="选择分类（可选）"
              allowClear
              value={sessionCategoryId}
              onChange={setSessionCategoryId}
              style={{ width: "100%" }}
            >
              {filteredCategories.map((c) => (
                <Select.Option key={c.id} value={c.id}>
                  {c.name}
                </Select.Option>
              ))}
            </Select>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 12, color: "var(--ant-color-text-secondary)", marginBottom: 4 }}>会话名称</label>
            <Input
              size="small"
              placeholder="可选，默认自动生成"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={{ backgroundColor: "var(--ant-color-bg-elevated)", borderColor: "var(--ant-color-border)", color: "var(--ant-color-text)" }}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 12, color: "var(--ant-color-text-secondary)", marginBottom: 6 }}>
              CLI 工具 <span style={{ color: "#ff4d4f" }}>*</span>
              <span style={{ fontSize: 10, color: "var(--ant-color-text-quaternary)", marginLeft: 6 }}>
                来自设置 · CLI 工具
              </span>
            </label>
            <div className="flex gap-2 flex-wrap">
              {sortedTools.map((meta) => {
                const toolInfo = getToolInfo(meta.id);
                const isAvailable = isCliToolAvailable(meta, cliTools);
                const isSelected = selectedTool === meta.id;

                return (
                  <Tooltip
                    key={meta.id}
                    title={`${meta.desc}${toolInfo?.version ? ` · v${toolInfo.version}` : ""}${isAvailable ? "" : " · 未安装"}`}
                    placement="top"
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "6px 12px",
                        borderRadius: 5,
                        cursor: isAvailable ? "pointer" : "default",
                        backgroundColor: isSelected ? meta.color : "var(--ant-color-bg-elevated)",
                        border: `1px solid ${isSelected ? meta.color : "var(--ant-color-border)"}`,
                        opacity: isAvailable ? 1 : 0.4,
                        transition: "all 0.15s",
                      }}
                      onClick={() => {
                        if (isAvailable) {
                          setSelectedTool(meta.id);
                          setCliParams(meta.id === "claude" ? { dangerouslySkipPermissions: true } : {});
                        }
                      }}
                    >
                      <div
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: 4,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: isSelected ? "rgba(255,255,255,0.2)" : `${meta.color}20`,
                          overflow: "hidden",
                          flexShrink: 0,
                          fontSize: 12,
                          color: isSelected ? "#ffffff" : meta.color,
                        }}
                      >
                        <CliToolBadge meta={meta} selected={isSelected} />
                      </div>
                      <span style={{ fontSize: 12, color: isSelected ? "#ffffff" : "var(--ant-color-text-secondary)" }}>
                        {meta.name}
                      </span>
                    </div>
                  </Tooltip>
                );
              })}
            </div>
          </div>

          {selectedTool !== "ssh" && selectedTool !== "terminal" && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 12, color: "var(--ant-color-text-secondary)", marginBottom: 4 }}>
                LLM 供应商
              </label>
              <Select
                size="small"
                placeholder="选择 LLM 供应商（可选）"
                allowClear
                value={llmProviderId}
                onChange={(id) => {
                  setLlmProviderId(id);
                  const provider = llmProviders.find((p) => p.id === id);
                  if (selectedTool === "claude" && provider) {
                    setClaudeModels(buildDefaultClaudeModels(provider));
                    setModelName(undefined);
                  } else if (provider) {
                    const defModel = provider.models.find((m) => m.isDefault);
                    setModelName(defModel?.modelName);
                    setClaudeModels({});
                  } else {
                    setModelName(undefined);
                    setClaudeModels({});
                  }
                }}
                style={{ width: "100%" }}
              >
                {compatibleProviders(selectedTool).map((p) => (
                  <Select.Option key={p.id} value={p.id}>
                    {p.name}（{p.providerKind}）
                  </Select.Option>
                ))}
              </Select>
            </div>
          )}

          {selectedTool !== "ssh" && selectedTool !== "terminal" && llmProviderId && (
            <div style={{ marginBottom: 12 }}>
              {selectedTool === "claude" ? (
                // Claude Code: model mapping (provider already selected above)
                <>
                  <label style={{ display: "block", fontSize: 12, color: "#aaaaaa", marginBottom: 6 }}>
                    Claude Code 模型映射
                  </label>
                  {CLAUDE_TIER_ENTRIES.map(({ modelKey, oneMKey, label }) => {
                    const tierModel = claudeModels[modelKey];
                    const oneM = claudeModels[oneMKey] ?? false;
                    const provider = llmProviders.find((p) => p.id === llmProviderId);
                    return (
                      <div key={modelKey} style={{ marginBottom: 6 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 2 }}>
                          <label style={{ fontSize: 11, color: "var(--ant-color-text-secondary)" }}>{label}</label>
                          <span style={{ fontSize: 11, color: "var(--ant-color-text-tertiary)" }}>1M</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <Select
                            size="small"
                            placeholder="选择模型"
                            allowClear
                            value={tierModel}
                            onChange={(v) => setClaudeModels({ ...claudeModels, [modelKey]: v })}
                            style={{ flex: 1 }}
                          >
                            {(provider?.models ?? []).map((m) => (
                              <Select.Option key={m.id} value={m.modelName}>
                                {m.modelName}
                                {m.isDefault && <span className="text-[var(--ant-color-text-quaternary)] text-[10px] ml-2">默认</span>}
                              </Select.Option>
                            ))}
                          </Select>
                          <Checkbox
                            checked={oneM}
                            onChange={(e) => setClaudeModels({ ...claudeModels, [oneMKey]: e.target.checked })}
                          />
                        </div>
                      </div>
                    );
                  })}
                </>
              ) : (
                // Non-Claude: single model selector
                <>
                  <label style={{ display: "block", fontSize: 12, color: "var(--ant-color-text-secondary)", marginBottom: 4 }}>
                    模型
                  </label>
                  <Select
                    size="small"
                    placeholder="选择模型"
                    allowClear
                    value={modelName}
                    onChange={setModelName}
                    style={{ width: "100%" }}
                  >
                    {(llmProviders.find((p) => p.id === llmProviderId)?.models ?? []).map((m) => (
                      <Select.Option key={m.id} value={m.modelName}>
                        {m.modelName}
                        {m.isDefault && <span className="text-[var(--ant-color-text-quaternary)] text-[10px] ml-2">默认</span>}
                      </Select.Option>
                    ))}
                  </Select>
                </>
              )}
            </div>
          )}

          {!sessionCategoryId && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 12, color: "#aaaaaa", marginBottom: 4 }}>颜色标记</label>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {COLOR_PRESETS.map((color) => (
                  <div
                    key={color}
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      backgroundColor: color,
                      border: selectedColor === color ? "2px solid var(--ant-color-bg-container)" : "2px solid transparent",
                      boxShadow: selectedColor === color ? `0 0 0 1px ${color}` : "none",
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                    onClick={() => setSelectedColor(color)}
                  />
                ))}
              </div>
            </div>
          )}

          {selectedTool !== "ssh" && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 12, color: "#aaaaaa", marginBottom: 4 }}>思考强度</label>
              <div className="flex gap-2">
                {[{ value: "low", label: "低", color: "#52c41a" }, { value: "medium", label: "中", color: "#1677ff" }, { value: "high", label: "高", color: "#722ed1" }].map((t) => {
                  const isSelected = thinkingIntensity === t.value;
                  return (
                    <div
                      key={t.value}
                      onClick={() => setThinkingIntensity(t.value)}
                      style={{
                        padding: "5px 14px",
                        borderRadius: 6,
                        border: `1.5px solid ${isSelected ? t.color : "var(--ant-color-border)"}`,
                        background: isSelected ? `${t.color}10` : "transparent",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        transition: "all 0.15s",
                      }}
                    >
                      <div style={{
                        width: 7, height: 7, borderRadius: "50%",
                        background: isSelected ? t.color : "var(--ant-color-text-quaternary)"
                      }} />
                      <span style={{
                        fontSize: 12,
                        fontWeight: isSelected ? 600 : 400,
                        color: isSelected ? t.color : "var(--ant-color-text-secondary)",
                      }}>{t.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {selectedTool !== "ssh" && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 12, color: "var(--ant-color-text-secondary)", marginBottom: 4 }}>会话模板</label>
              <Select
                size="small"
                placeholder="选择模板（可选）"
                allowClear
                value={templateId}
                onChange={setTemplateId}
                style={{ width: "100%" }}
              >
                {BUILTIN_SESSION_TEMPLATES.map((t) => (
                  <Select.Option key={t.id} value={t.id}>
                    {t.name}
                    {t.description && <span className="text-[var(--ant-color-text-quaternary)] text-[10px] ml-2">{t.description}</span>}
                  </Select.Option>
                ))}
              </Select>
            </div>
          )}

          {selectedTool === "claude" && (
            <div style={{ marginBottom: 12, borderTop: "1px solid var(--ant-color-border-secondary)", paddingTop: 8 }}>
              <label style={{ display: "block", fontSize: 12, color: "#aaaaaa", marginBottom: 6 }}>
                Claude Code 参数
              </label>
              <CliArgsClaude value={cliParams} onChange={setCliParams} />
            </div>
          )}

          {selectedTool === "ssh" && (
            <div style={{ marginBottom: 12, borderTop: "1px solid var(--ant-color-border-secondary)", paddingTop: 8 }}>
              <label style={{ display: "block", fontSize: 12, color: "#aaaaaa", marginBottom: 6 }}>
                SSH 连接参数
              </label>
              <SshArgsFields
                value={sshArgs}
                onChange={setSshArgs}
                onTest={handleTestSsh}
                testing={testingConnection}
              />
            </div>
          )}

          <div style={{ marginBottom: 12, borderTop: "1px solid #2a2d38", paddingTop: 8 }}>
            <label style={{ display: "block", fontSize: 12, color: "var(--ant-color-text-secondary)", marginBottom: 4 }}>
              环境变量
              <span style={{ fontSize: 10, color: "var(--ant-color-text-quaternary)", marginLeft: 4 }}>每行 KEY=VALUE</span>
            </label>
            <Input.TextArea
              size="small"
              rows={2}
              placeholder={`NODE_OPTIONS=--max-old-space-size=4096\nPYTHONPATH=/usr/local/lib`}
              value={envVars}
              onChange={(e) => setEnvVars(e.target.value)}
              style={{ backgroundColor: "var(--ant-color-bg-elevated)", borderColor: "var(--ant-color-border)", color: "var(--ant-color-text)", resize: "vertical" }}
            />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12, padding: "12px 20px", borderTop: "1px solid var(--ant-color-border-secondary)" }}>
          <button
            onClick={handleCancel}
            style={{
              padding: "6px 16px",
              fontSize: 14,
              color: "var(--ant-color-text-secondary)",
              borderRadius: 6,
              background: "none",
              border: "1px solid var(--ant-color-border)",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--ant-color-bg-elevated)")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
          >
            取消
          </button>
          <button
            onClick={handleOk}
            disabled={!selectedTool || !projectId}
            style={{
              padding: "6px 20px",
              fontSize: 14,
              color: "#ffffff",
              borderRadius: 6,
              backgroundColor: selectedTool && projectId ? "var(--ant-color-primary)" : "var(--ant-color-bg-elevated)",
              border: "none",
              cursor: selectedTool && projectId ? "pointer" : "not-allowed",
              opacity: selectedTool && projectId ? 1 : 0.5,
            }}
          >
            创建
          </button>
        </div>
      </div>
    </div>
  );
}

function CliToolBadge({ meta, selected }: { meta: CliToolMeta; selected: boolean }) {
  if (meta.icon) {
    return (
      <img
        src={meta.icon}
        alt={meta.id}
        style={{ width: 14, height: 14, filter: selected ? "none" : "none" }}
        draggable={false}
      />
    );
  }
  return meta.iconComponent ?? null;
}