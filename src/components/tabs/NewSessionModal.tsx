import { useState, useEffect } from "react";
import { Input, Select, Tooltip, App } from "antd";
import { CheckCircleOutlined, CloseCircleOutlined } from "@ant-design/icons";
import { useAppStore } from "../../stores/appStore";
import { detectCliTools } from "../../utils/ipc";
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
  icon: string;
  color: string;
  desc: string;
}> = {
  claude: { icon: "/claude.png", color: "#722ed1", desc: "Anthropic 官方 CLI" },
  codex: { icon: "/codex.png", color: "#1890ff", desc: "OpenAI Codex CLI" },
  gemini: { icon: "/gemini.png", color: "#1677ff", desc: "Google Gemini CLI" },
  opencode: { icon: "/opencode.png", color: "#fa8c16", desc: "开源编码助手" },
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
  const [hoveredTool, setHoveredTool] = useState<ToolType | null>(null);

  useEffect(() => {
    if (isOpen && cliTools.length === 0) {
      detectCliTools().then(setCliTools).catch(() => {});
    }
  }, [isOpen, cliTools.length, setCliTools]);

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
    }
  }, [isOpen, globalThinkingIntensity]);

  const project = projects.find((p) => p.id === projectId);

  const filteredProfiles = profiles.filter((p) =>
    selectedTool ? p.toolType === selectedTool : true,
  );

  const getToolInfo = (toolType: ToolType): CliTool | undefined =>
    cliTools.find((t) => t.toolType === toolType);

  const handleOk = async () => {
    if (!selectedTool) {
      message.warning("请选择 CLI 工具");
      return;
    }
    if (!projectId) {
      message.warning("请先创建或选择项目");
      return;
    }

    const cliArgs = buildCliArgs(selectedTool, cliParams);

    try {
      await createSession({
        projectId,
        toolType: selectedTool,
        title: title.trim() || undefined,
        profileId,
        color: selectedColor,
        thinkingIntensity,
        templateId,
        cliArgs: cliArgs || undefined,
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
      style={{ backgroundColor: "rgba(0,0,0,0.6)", zIndex: 1000 }}
      onClick={(e) => { if (e.target === e.currentTarget) handleCancel(); }}
    >
      <div
        className="new-session-modal flex flex-col overflow-hidden"
        style={{
          width: 480,
          maxHeight: "90vh",
          backgroundColor: "#1e2229",
          border: "1px solid #2a2d38",
          borderRadius: 12,
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: "1px solid #2a2d38" }}>
          <h3 className="text-base font-medium m-0" style={{ color: "#e0e0e0" }}>
            新建会话
            {project && (
              <span className="text-xs text-[#888888] ml-2">— {project.name}</span>
            )}
          </h3>
          <button
            onClick={handleCancel}
            className="text-lg leading-none cursor-pointer"
            style={{ background: "none", border: "none", color: "#888888" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#e0e0e0")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#888888")}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* CLI 工具选择 - 30px 行高图标行 */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 12, color: "#aaaaaa", marginBottom: 6 }}>
              CLI 工具 <span style={{ color: "#ff4d4f" }}>*</span>
            </label>
            <div className="space-y-0.5">
              {(Object.keys(TOOL_META) as ToolType[]).map((toolType) => {
                const meta = TOOL_META[toolType];
                const toolInfo = getToolInfo(toolType);
                const isAvailable = toolInfo?.isAvailable ?? false;
                const isSelected = selectedTool === toolType;
                const isHovered = hoveredTool === toolType;

                return (
                  <Tooltip
                    key={toolType}
                    title={isHovered ? `${meta.desc}${toolInfo?.version ? ` · v${toolInfo.version}` : ""}` : ""}
                    placement="right"
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        height: 30,
                        padding: "0 8px",
                        borderRadius: 4,
                        cursor: isAvailable ? "pointer" : "default",
                        backgroundColor: isSelected ? "#252835" : "transparent",
                        border: `1px solid ${isSelected ? meta.color : "transparent"}`,
                        opacity: isAvailable ? 1 : 0.4,
                        transition: "all 0.15s",
                      }}
                      onClick={() => {
                        if (isAvailable) {
                          setSelectedTool(toolType);
                          setCliParams({});
                        }
                      }}
                      onMouseEnter={() => setHoveredTool(toolType)}
                      onMouseLeave={() => setHoveredTool(null)}
                    >
                      <div
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: 4,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: `${meta.color}20`,
                          overflow: "hidden",
                          flexShrink: 0,
                        }}
                      >
                        <img
                          src={meta.icon}
                          alt={toolType}
                          style={{ width: 14, height: 14 }}
                          draggable={false}
                        />
                      </div>
                      <span style={{ fontSize: 12, color: isSelected ? "#e0e0e0" : "#cccccc", flex: 1 }}>
                        {TOOL_DISPLAY_NAMES[toolType]}
                      </span>
                      {isAvailable ? (
                        <CheckCircleOutlined style={{ fontSize: 10, color: "#52c41a" }} />
                      ) : (
                        <CloseCircleOutlined style={{ fontSize: 10, color: "#666666" }} />
                      )}
                    </div>
                  </Tooltip>
                );
              })}
            </div>
          </div>

          {/* Profile */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 12, color: "#aaaaaa", marginBottom: 4 }}>Profile</label>
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

          {/* 标签页标题 */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 12, color: "#aaaaaa", marginBottom: 4 }}>标签页标题</label>
            <Input
              size="small"
              placeholder="可选，默认自动生成"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={{ backgroundColor: "#252830", borderColor: "#2a2d38", color: "#cccccc" }}
            />
          </div>

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
                    border: selectedColor === color ? "2px solid #ffffff" : "2px solid transparent",
                    boxShadow: selectedColor === color ? `0 0 0 1px ${color}` : "none",
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                  onClick={() => setSelectedColor(color)}
                />
              ))}
            </div>
          </div>

          {/* 思考强度 */}
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

          {/* 会话模板 */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 12, color: "#aaaaaa", marginBottom: 4 }}>会话模板</label>
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
                  {t.description && <span className="text-[#666666] text-[10px] ml-2">{t.description}</span>}
                </Select.Option>
              ))}
            </Select>
          </div>

          {/* CLI 专属参数 */}
          {selectedTool === "claude" && (
            <div style={{ marginBottom: 12, borderTop: "1px solid #2a2d38", paddingTop: 8 }}>
              <label style={{ display: "block", fontSize: 12, color: "#aaaaaa", marginBottom: 6 }}>
                Claude Code 参数
              </label>
              <CliArgsClaude value={cliParams} onChange={setCliParams} />
            </div>
          )}

          {/* 环境变量 */}
          <div style={{ marginBottom: 12, borderTop: "1px solid #2a2d38", paddingTop: 8 }}>
            <label style={{ display: "block", fontSize: 12, color: "#aaaaaa", marginBottom: 4 }}>
              环境变量
              <span style={{ fontSize: 10, color: "#666666", marginLeft: 4 }}>每行 KEY=VALUE</span>
            </label>
            <Input.TextArea
              size="small"
              rows={2}
              placeholder={`NODE_OPTIONS=--max-old-space-size=4096\nPYTHONPATH=/usr/local/lib`}
              value={envVars}
              onChange={(e) => setEnvVars(e.target.value)}
              style={{ backgroundColor: "#252830", borderColor: "#2a2d38", color: "#cccccc", resize: "vertical" }}
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12, padding: "12px 20px", borderTop: "1px solid #2a2d38" }}>
          <button
            onClick={handleCancel}
            style={{
              padding: "6px 16px",
              fontSize: 14,
              color: "#cccccc",
              borderRadius: 6,
              background: "none",
              border: "1px solid #2a2d38",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#252830")}
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
              backgroundColor: selectedTool && projectId ? "#3b82f6" : "#2a2d38",
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
