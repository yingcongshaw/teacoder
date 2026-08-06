import { useState, useEffect } from "react";
import {
  Form,
  Select,
  Input,
  App,
  Tooltip,
} from "antd";
import {
  FolderOpenOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DownOutlined,
} from "@ant-design/icons";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../../stores/appStore";
import { detectCliTools, startSession } from "../../utils/ipc";
import { TOOL_DISPLAY_NAMES } from "../../types";
import type { ToolType, CliTool } from "../../types";

interface NewSessionModalProps {
  open: boolean;
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

function parseEnvVars(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

function parseArgs(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

const darkInputStyle: React.CSSProperties = {
  backgroundColor: "#252830",
  borderColor: "#2a2d38",
  color: "#cccccc",
};

const darkSelectStyle: React.CSSProperties = {
  backgroundColor: "#252830",
  borderColor: "#2a2d38",
  color: "#cccccc",
};

export default function NewSessionModal({ open: isOpen, onClose }: NewSessionModalProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const createSession = useAppStore((s) => s.createSession);
  const deleteSession = useAppStore((s) => s.deleteSession);
  const cliTools = useAppStore((s) => s.cliTools);
  const setCliTools = useAppStore((s) => s.setCliTools);
  const profiles = useAppStore((s) => s.profiles);
  const [selectedTool, setSelectedTool] = useState<ToolType | null>(null);
  const [selectedColor, setSelectedColor] = useState<string>(COLOR_PRESETS[0]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (isOpen && cliTools.length === 0) {
      detectCliTools().then(setCliTools).catch(() => {});
    }
  }, [isOpen, cliTools.length, setCliTools]);

  const handleBrowseFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected) {
        form.setFieldValue("workDir", selected);
      }
    } catch {
      // user cancelled or not supported
    }
  };

  const handleOk = () => {
    const values = form.getFieldsValue();
    const envVars = parseEnvVars(values.envVars || "");
    const args = parseArgs(values.args || "");
    const tabId = crypto.randomUUID();
    createSession({
      id: tabId,
      title: values.title || "",
      toolType: values.toolType,
      profileId: values.profileId || "",
      workDir: values.workDir || "~",
      color: selectedColor,
      isRunning: true,
      envVars: values.envVars || "",
      args: values.args || "",
      createdAt: Date.now(),
    });
    startSession({
      toolType: values.toolType,
      profileId: values.profileId || "",
      workDir: values.workDir || "~",
      tabId,
      envVars,
      args,
    }).catch((err) => {
      deleteSession(tabId);
      message.error(`启动会话失败: ${err}`);
    });
    form.resetFields();
    setSelectedTool(null);
    setSelectedColor(COLOR_PRESETS[0]);
    setShowAdvanced(false);
    onClose();
  };

  const handleCancel = () => {
    form.resetFields();
    setSelectedTool(null);
    setSelectedColor(COLOR_PRESETS[0]);
    setShowAdvanced(false);
    onClose();
  };

  const filteredProfiles = profiles.filter((p) =>
    selectedTool ? p.toolType === selectedTool : true,
  );

  const getToolInfo = (toolType: ToolType): CliTool | undefined =>
    cliTools.find((t) => t.toolType === toolType);

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
          <h3 className="text-base font-medium m-0" style={{ color: "#e0e0e0" }}>新建会话</h3>
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
          <Form
            form={form}
            layout="vertical"
            initialValues={{ workDir: "~" }}
            requiredMark={false}
            className="new-session-form"
          >
            {/* CLI 工具选择 - Card Grid */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontSize: 12, color: "#aaaaaa", marginBottom: 8 }}>
                CLI 工具 <span style={{ color: "#ff4d4f" }}>*</span>
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {(Object.keys(TOOL_META) as ToolType[]).map((toolType) => {
                  const meta = TOOL_META[toolType];
                  const toolInfo = getToolInfo(toolType);
                  const isAvailable = toolInfo?.isAvailable ?? false;
                  const isSelected = selectedTool === toolType;

                  return (
                    <div
                      key={toolType}
                      style={{
                        borderRadius: 8,
                        border: `1px solid ${isSelected ? meta.color : "#2a2d38"}`,
                        padding: 10,
                        cursor: isAvailable ? "pointer" : "default",
                        backgroundColor: isSelected ? "#252835" : isAvailable ? "#1f222b" : "#181b22",
                        opacity: isAvailable ? 1 : 0.5,
                        boxShadow: isSelected ? `0 0 0 1px ${meta.color}` : "none",
                        transition: "all 0.2s",
                      }}
                      onClick={() => {
                        if (isAvailable) {
                          setSelectedTool(toolType);
                          form.setFieldValue("toolType", toolType);
                        }
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                        <div
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 6,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            backgroundColor: `${meta.color}20`,
                            overflow: "hidden",
                          }}
                        >
                          <img
                            src={meta.icon}
                            alt={toolType}
                            style={{ width: 20, height: 20 }}
                            draggable={false}
                          />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 13, fontWeight: 500, color: "#e0e0e0" }}>
                              {TOOL_DISPLAY_NAMES[toolType]}
                            </span>
                            {isAvailable ? (
                              <CheckCircleOutlined style={{ fontSize: 11, color: "#52c41a" }} />
                            ) : (
                              <CloseCircleOutlined style={{ fontSize: 11, color: "#666666" }} />
                            )}
                          </div>
                          <div style={{ fontSize: 10, color: "#888888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{meta.desc}</div>
                        </div>
                      </div>
                      {toolInfo?.version && (
                        <div style={{ fontSize: 10, color: "#666666", paddingLeft: 38 }}>
                          v{toolInfo.version}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <Form.Item name="toolType" hidden rules={[{ required: true, message: "请选择 CLI 工具" }]}>
                <Input />
              </Form.Item>
            </div>

            {/* Profile */}
            <Form.Item
              name="profileId"
              label="Profile"
              className="dark-form-item"
            >
              <Select
                placeholder="选择 Profile（可选）"
                allowClear
                style={darkSelectStyle}
                popupClassName="dark-select-dropdown"
              >
                {filteredProfiles.map((p) => (
                  <Select.Option key={p.id} value={p.id}>
                    {p.name}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>

            {/* 工作目录 */}
            <Form.Item
              name="workDir"
              label="工作目录"
              className="dark-form-item"
            >
              <Input
                placeholder="~/projects/my-app"
                style={darkInputStyle}
                suffix={
                  <Tooltip title="浏览文件夹">
                    <FolderOpenOutlined
                      style={{ color: "#888888", cursor: "pointer" }}
                      onClick={handleBrowseFolder}
                    />
                  </Tooltip>
                }
              />
            </Form.Item>

            {/* 标签页标题 */}
            <Form.Item
              name="title"
              label="标签页标题"
              className="dark-form-item"
            >
              <Input placeholder="可选，默认自动生成" style={darkInputStyle} />
            </Form.Item>

            {/* 颜色标记 */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontSize: 12, color: "#aaaaaa", marginBottom: 8 }}>颜色标记</label>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {COLOR_PRESETS.map((color) => (
                  <div
                    key={color}
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      backgroundColor: color,
                      border: selectedColor === color ? "2px solid #ffffff" : "2px solid transparent",
                      boxShadow: selectedColor === color ? `0 0 0 2px ${color}` : "none",
                      cursor: "pointer",
                      transition: "all 0.2s",
                    }}
                    onClick={() => setSelectedColor(color)}
                  />
                ))}
              </div>
            </div>

            {/* 高级选项 */}
            <div style={{ borderTop: "1px solid #2a2d38", paddingTop: 12 }}>
              <div
                style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#888888", cursor: "pointer" }}
                onClick={() => setShowAdvanced(!showAdvanced)}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#cccccc")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "#888888")}
              >
                <DownOutlined
                  style={{
                    fontSize: 10,
                    transform: showAdvanced ? "rotate(0deg)" : "rotate(-90deg)",
                    transition: "transform 0.2s",
                  }}
                />
                <span>高级选项</span>
              </div>
              {showAdvanced && (
                <div style={{ marginTop: 12 }}>
                  <Form.Item
                    name="envVars"
                    label="环境变量"
                    className="dark-form-item"
                    extra={<span style={{ fontSize: 10, color: "#666666" }}>每行一个，格式 KEY=VALUE</span>}
                  >
                    <Input.TextArea
                      rows={2}
                      placeholder={`NODE_OPTIONS=--max-old-space-size=4096\nPYTHONPATH=/usr/local/lib`}
                      style={{ ...darkInputStyle, resize: "vertical" }}
                    />
                  </Form.Item>
                  <Form.Item
                    name="args"
                    label="启动参数"
                    className="dark-form-item"
                    extra={<span style={{ fontSize: 10, color: "#666666" }}>空格分隔的命令行参数</span>}
                  >
                    <Input
                      placeholder="--model claude-sonnet-4 --verbose"
                      style={darkInputStyle}
                    />
                  </Form.Item>
                </div>
              )}
            </div>
          </Form>
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
            disabled={!selectedTool}
            style={{
              padding: "6px 20px",
              fontSize: 14,
              color: "#ffffff",
              borderRadius: 6,
              backgroundColor: selectedTool ? "#3b82f6" : "#2a2d38",
              border: "none",
              cursor: selectedTool ? "pointer" : "not-allowed",
              opacity: selectedTool ? 1 : 0.5,
            }}
          >
            创建
          </button>
        </div>
      </div>

      {/* Scoped styles for dark form items */}
      <style>{`
        .new-session-modal .new-session-form .ant-form-item {
          margin-bottom: 14px !important;
        }
        .new-session-modal .dark-form-item .ant-form-item-label {
          padding-bottom: 4px !important;
        }
        .new-session-modal .dark-form-item .ant-form-item-label > label {
          color: #aaaaaa !important;
          font-size: 12px !important;
          height: 20px !important;
          line-height: 20px !important;
        }
        .new-session-modal .dark-form-item .ant-form-item-label::after {
          content: '' !important;
        }
        .new-session-modal .dark-form-item .ant-input {
          background-color: #252830 !important;
          border-color: #2a2d38 !important;
          color: #cccccc !important;
          height: 32px !important;
        }
        .new-session-modal .dark-form-item .ant-input::placeholder {
          color: #666666 !important;
        }
        .new-session-modal .dark-form-item .ant-input:hover {
          border-color: #3a3d48 !important;
        }
        .new-session-modal .dark-form-item .ant-input:focus,
        .new-session-modal .dark-form-item .ant-input-focused {
          border-color: #3b82f6 !important;
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15) !important;
        }
        .new-session-modal .dark-form-item .ant-select-selector {
          background-color: #252830 !important;
          border-color: #2a2d38 !important;
          color: #cccccc !important;
          height: 32px !important;
        }
        .new-session-modal .dark-form-item .ant-select-selection-search-input {
          height: 30px !important;
        }
        .new-session-modal .dark-form-item .ant-select-selection-placeholder {
          color: #666666 !important;
          line-height: 30px !important;
        }
        .new-session-modal .dark-form-item .ant-select-selection-item {
          line-height: 30px !important;
        }
        .new-session-modal .dark-form-item .ant-select-arrow {
          color: #888888 !important;
        }
        .new-session-modal .dark-form-item .ant-input-textarea {
          background-color: #252830 !important;
          border-color: #2a2d38 !important;
          border-radius: 6px !important;
        }
        .new-session-modal .dark-form-item .ant-input-textarea textarea {
          background-color: #252830 !important;
          border-color: transparent !important;
          color: #cccccc !important;
        }
        .new-session-modal .dark-form-item .ant-input-textarea textarea::placeholder {
          color: #666666 !important;
        }
        .new-session-modal .dark-form-item .ant-input-textarea:focus-within {
          border-color: #3b82f6 !important;
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15) !important;
        }
        .new-session-modal .dark-form-item .ant-form-item-extra {
          font-size: 10px !important;
          color: #666666 !important;
          min-height: 16px !important;
          margin-top: 2px !important;
        }
        .dark-select-dropdown {
          background-color: #252830 !important;
        }
        .dark-select-dropdown .ant-select-item {
          color: #cccccc !important;
        }
        .dark-select-dropdown .ant-select-item-option-active {
          background-color: #2a2d38 !important;
        }
        .dark-select-dropdown .ant-select-item-option-selected {
          background-color: #2a2d38 !important;
          color: #3b82f6 !important;
        }
      `}</style>
    </div>
  );
}
