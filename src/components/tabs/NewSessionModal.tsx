import { useState, useEffect, useRef } from "react";
import { Input, Select, Tooltip, App, Button } from "antd";
import {
  DesktopOutlined,
  CloudOutlined,
} from "@ant-design/icons";
import { useAppStore } from "../../stores/appStore";
import { detectCliTools, testSshConnection } from "../../utils/ipc";
import { TOOL_DISPLAY_NAMES, BUILTIN_SESSION_TEMPLATES } from "../../types";
import type { ToolType, CliTool } from "../../types";
import CliArgsClaude from "../cli/CliArgsClaude";

interface NewSessionModalProps {
  open: boolean;
  projectId: string | null;
  onClose: () => void;
}

const COLOR_PRESETS = [
  "#722ed1", "#1890ff", "#1677ff", "#fa8c16",
  "#52c41a", "#13c2c2", "#eb2f96", "#ff4d4f",
];

const TOOL_META: Record<ToolType, {
  icon?: string;
  iconComponent?: React.ReactNode;
  color: string;
  desc: string;
  alwaysAvailable?: boolean;
}> = {
  claude: { icon: "/claude.png", color: "#722ed1", desc: "Anthropic 官方 CLI" },
  codex: { icon: "/codex.png", color: "#1890ff", desc: "OpenAI Codex CLI" },
  gemini: { icon: "/gemini.png", color: "#1677ff", desc: "Google Gemini CLI" },
  antigravity: { icon: "", color: "#52c41a", desc: "Antigravity CLI" },
  opencode: { icon: "/opencode.png", color: "#fa8c16", desc: "开源编码助手" },
  terminal: { iconComponent: <DesktopOutlined />, color: "#52c41a", desc: "系统终端", alwaysAvailable: true },
  ssh: { iconComponent: <CloudOutlined />, color: "#1677ff", desc: "SSH 远程连接", alwaysAvailable: true },
};

const THINKING_OPTIONS = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
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

export default function NewSessionModal({ open: isOpen, projectId, onClose }: NewSessionModalProps) {
  const { message } = App.useApp();
  const createSession = useAppStore((s) => s.createSession);
  const cliTools = useAppStore((s) => s.cliTools);
  const setCliTools = useAppStore((s) => s.setCliTools);
  const profiles = useAppStore((s) => s.profiles);
  const globalThinkingIntensity = useAppStore((s) => s.globalThinkingIntensity);
  const projects = useAppStore((s) => s.projects);

  const [selectedTool, setSelectedTool] = useState<ToolType | null>(null);
  const [selectedColor, setSelectedColor] = useState<string>(COLOR_PRESETS[0]);
  const [title, setTitle] = useState("");
  const [profileId, setProfileId] = useState<string | undefined>();
  const [thinkingIntensity, setThinkingIntensity] = useState(globalThinkingIntensity);
  const [templateId, setTemplateId] = useState<string | undefined>();
  const [envVars, setEnvVars] = useState("");
  const [cliParams, setCliParams] = useState<Record<string, unknown>>({});

  // SSH 连接参数
  const [sshHostname, setSshHostname] = useState("");
  const [sshPort, setSshPort] = useState(22);
  const [sshUsername, setSshUsername] = useState("root");
  const [sshPassword, setSshPassword] = useState("");
  const [sshIdentityFile, setSshIdentityFile] = useState("");
  const [testingConnection, setTestingConnection] = useState(false);

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
    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  // 重置表单
  useEffect(() => {
    if (isOpen) {
      setSelectedTool(null);
      setSelectedColor(COLOR_PRESETS[0]);
      setTitle("");
      setProfileId(undefined);
      setThinkingIntensity(globalThinkingIntensity);
      setTemplateId(undefined);
      setEnvVars("");
      setCliParams({});
      setSshHostname("");
      setSshPort(22);
      setSshUsername("root");
      setSshPassword("");
      setSshIdentityFile("");
    }
  }, [isOpen, globalThinkingIntensity]);

  const project = projects.find((p) => p.id === projectId);

  const filteredProfiles = profiles.filter((p) =>
    selectedTool ? p.toolType === selectedTool : true,
  );

  const getToolInfo = (toolType: ToolType): CliTool | undefined =>
    cliTools.find((t) => t.toolType === toolType);

  // 构建 SSH 连接参数
  const buildSshArgs = (): string => {
    return JSON.stringify({
      hostname: sshHostname,
      port: sshPort,
      username: sshUsername,
      password: sshPassword,
      identityFile: sshIdentityFile,
    });
  };

  // 测试 SSH 连接
  const handleTestSsh = async () => {
    if (!sshHostname.trim()) {
      message.warning("请填写主机名");
      return;
    }

    setTestingConnection(true);
    try {
      const result = await testSshConnection({
        hostname: sshHostname,
        port: sshPort,
        username: sshUsername,
        password: sshPassword || undefined,
        identity_file: sshIdentityFile || undefined,
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

    // SSH 连接需要验证必填字段
    if (selectedTool === "ssh") {
      if (!sshHostname.trim()) {
        message.warning("请填写主机名");
        return;
      }
    }

    // 构建 CLI 参数
    let finalCliArgs: string | undefined;
    if (selectedTool === "ssh") {
      finalCliArgs = buildSshArgs();
    } else {
      finalCliArgs = buildCliArgs(selectedTool, cliParams) || undefined;
    }

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
        {/* Header - drag handle */}
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

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* 会话名称 */}
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

          {/* CLI 工具选择 - 横向排列 */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 12, color: "var(--ant-color-text-secondary)", marginBottom: 6 }}>
              CLI 工具 <span style={{ color: "#ff4d4f" }}>*</span>
            </label>
            <div className="flex gap-2 flex-wrap">
              {(Object.keys(TOOL_META) as ToolType[]).map((toolType) => {
                const meta = TOOL_META[toolType];
                const toolInfo = getToolInfo(toolType);
                const isAvailable = toolInfo?.isAvailable ?? meta.alwaysAvailable ?? false;
                const isSelected = selectedTool === toolType;

                return (
                  <Tooltip
                    key={toolType}
                    title={`${meta.desc}${toolInfo?.version ? ` · v${toolInfo.version}` : ""}`}
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
                        border: `1px solid ${isSelected ? meta.color : "var(--ant-color-border)"}}`,
                        opacity: isAvailable ? 1 : 0.4,
                        transition: "all 0.15s",
                      }}
                      onClick={() => {
                        if (isAvailable) {
                          setSelectedTool(toolType);
                          // Claude Code 默认跳过权限
                          setCliParams(toolType === "claude" ? { dangerouslySkipPermissions: true } : {});
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
                        {meta.icon ? (
                          <img
                            src={meta.icon}
                            alt={toolType}
                            style={{ width: 14, height: 14 }}
                            draggable={false}
                          />
                        ) : meta.iconComponent ? (
                          meta.iconComponent
                        ) : null}
                      </div>
                      <span style={{ fontSize: 12, color: isSelected ? "#ffffff" : "var(--ant-color-text-secondary)" }}>
                        {TOOL_DISPLAY_NAMES[toolType]}
                      </span>
                    </div>
                  </Tooltip>
                );
              })}
            </div>
          </div>

          {/* Profile - SSH 和 Terminal 不需要 */}
          {selectedTool !== "ssh" && selectedTool !== "terminal" && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 12, color: "var(--ant-color-text-secondary)", marginBottom: 4 }}>Profile</label>
              <Select
                placeholder="选择 Profile（可选）"
                allowClear
                value={profileId}
                onChange={setProfileId}
                style={{ width: "100%" }}
                size="small"
              >
                {filteredProfiles.map((p) => (
                  <Select.Option key={p.id} value={p.id}>
                    {p.name}
                </Select.Option>
              ))}
            </Select>
            </div>
          )}

          {/* 颜色标记 */}
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

          {/* 思考强度 - SSH 不需要 */}
          {selectedTool !== "ssh" && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 12, color: "#aaaaaa", marginBottom: 4 }}>思考强度</label>
              <Select
                size="small"
                value={thinkingIntensity}
                onChange={setThinkingIntensity}
                style={{ width: 120 }}
                options={THINKING_OPTIONS}
              />
            </div>
          )}

          {/* 会话模板 - SSH 不需要 */}
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

          {/* CLI 专属参数 */}
          {selectedTool === "claude" && (
            <div style={{ marginBottom: 12, borderTop: "1px solid var(--ant-color-border-secondary)", paddingTop: 8 }}>
              <label style={{ display: "block", fontSize: 12, color: "#aaaaaa", marginBottom: 6 }}>
                Claude Code 参数
              </label>
              <CliArgsClaude value={cliParams} onChange={setCliParams} />
            </div>
          )}

          {/* SSH 连接参数 */}
          {selectedTool === "ssh" && (
            <div style={{ marginBottom: 12, borderTop: "1px solid var(--ant-color-border-secondary)", paddingTop: 8 }}>
              <label style={{ display: "block", fontSize: 12, color: "#aaaaaa", marginBottom: 6 }}>
                SSH 连接参数
              </label>
              <div className="flex flex-col gap-2">
                <div className="flex gap-2 items-center">
                  <Input
                    size="small"
                    placeholder="主机名 *"
                    value={sshHostname}
                    onChange={(e) => setSshHostname(e.target.value)}
                    style={{ flex: 2, backgroundColor: "var(--ant-color-bg-elevated)", borderColor: "var(--ant-color-border)", color: "var(--ant-color-text)" }}
                  />
                  <Input
                    size="small"
                    placeholder="端口"
                    type="number"
                    value={sshPort}
                    onChange={(e) => setSshPort(parseInt(e.target.value) || 22)}
                    style={{ flex: 1, backgroundColor: "var(--ant-color-bg-elevated)", borderColor: "var(--ant-color-border)", color: "var(--ant-color-text)" }}
                  />
                </div>
                <Input
                  size="small"
                  placeholder="用户名（默认为 root）"
                  value={sshUsername}
                  onChange={(e) => setSshUsername(e.target.value)}
                  style={{ backgroundColor: "var(--ant-color-bg-elevated)", borderColor: "var(--ant-color-border)", color: "var(--ant-color-text)" }}
                />
                <Input
                  size="small"
                  placeholder="密码（PublicKey 优先）"
                  type="password"
                  value={sshPassword}
                  onChange={(e) => setSshPassword(e.target.value)}
                  style={{ backgroundColor: "var(--ant-color-bg-elevated)", borderColor: "var(--ant-color-border)", color: "var(--ant-color-text)" }}
                />
                <Input
                  size="small"
                  placeholder="PublicKey 路径（如 ~/.ssh/id_rsa）"
                  value={sshIdentityFile}
                  onChange={(e) => setSshIdentityFile(e.target.value)}
                  style={{ backgroundColor: "var(--ant-color-bg-elevated)", borderColor: "var(--ant-color-border)", color: "var(--ant-color-text)" }}
                />
                <div className="flex justify-end">
                  <Button
                    size="small"
                    onClick={handleTestSsh}
                    loading={testingConnection}
                  >
                    测试连接
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* 环境变量 */}
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

        {/* Footer */}
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
