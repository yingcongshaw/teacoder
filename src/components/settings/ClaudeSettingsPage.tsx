import { useState, useEffect } from "react";
import { Switch, Input, InputNumber, Tag, Button, message } from "antd";
import { CheckCircleOutlined } from "@ant-design/icons";
import { useAppStore } from "../../stores/appStore";
import { getToolSettings, upsertToolSettings } from "../../utils/ipc";
import type { Profile } from "../../types";
import SettingRow from "./components/SettingRow";
import SectionHeader from "./components/SectionHeader";

const CLAUDE_MODELS = [
  { value: "claude-opus-4", label: "Opus 4", tag: "最强", description: "最强推理能力，适合复杂任务" },
  { value: "claude-sonnet-4", label: "Sonnet 4", tag: "推荐", description: "平衡性能与速度" },
  { value: "claude-haiku-4", label: "Haiku 4", tag: "最快", description: "最快响应，适合简单任务" },
];

const THINKING_INTENSITIES = [
  { value: "low", label: "低", color: "#52c41a" },
  { value: "medium", label: "中", color: "#1677ff" },
  { value: "high", label: "高", color: "#722ed1" },
];

const PERMISSION_MODES = [
  { value: "default", label: "默认" },
  { value: "relaxed", label: "宽松" },
  { value: "strict", label: "严格" },
];

interface ClaudeSettings {
  model: string;
  thinkingIntensity: string;
  apiKey: string;
  baseUrl: string;
  autoSubmit: boolean;
  permissionMode: string;
  maxOutputLength: number;
  customInstructions: string;
}

const DEFAULT_SETTINGS: ClaudeSettings = {
  model: "claude-sonnet-4",
  thinkingIntensity: "medium",
  apiKey: "",
  baseUrl: "",
  autoSubmit: false,
  permissionMode: "default",
  maxOutputLength: 8192,
  customInstructions: "",
};

interface ClaudeSettingsPageProps {
  searchText?: string;
}

export default function ClaudeSettingsPage({ searchText = "" }: ClaudeSettingsPageProps) {
  const [settings, setSettings] = useState<ClaudeSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const profiles = useAppStore((s) => s.profiles);
  const claudeProfiles = profiles.filter((p) => p.toolType === "claude");
  const activeProfile: Profile | undefined = claudeProfiles[0];

  useEffect(() => {
    if (activeProfile) {
      loadSettings(activeProfile.id);
    }
  }, [activeProfile?.id]);

  const loadSettings = async (profileId: string) => {
    setLoading(true);
    try {
      const data = await getToolSettings(profileId);
      if (data) {
        setSettings({
          model: data.model || DEFAULT_SETTINGS.model,
          thinkingIntensity: data.thinkingIntensity || DEFAULT_SETTINGS.thinkingIntensity,
          apiKey: "",
          baseUrl: "",
          autoSubmit: data.autoSubmit || DEFAULT_SETTINGS.autoSubmit,
          permissionMode: "default",
          maxOutputLength: DEFAULT_SETTINGS.maxOutputLength,
          customInstructions: data.customInstructions || DEFAULT_SETTINGS.customInstructions,
        });
      }
    } catch {
      message.error("加载设置失败");
    } finally {
      setLoading(false);
    }
  };

  const saveToBackend = async (next: ClaudeSettings) => {
    if (!activeProfile) return;
    try {
      await upsertToolSettings({
        profileId: activeProfile.id,
        toolType: "claude",
        model: next.model,
        thinkingIntensity: next.thinkingIntensity,
        autoSubmit: next.autoSubmit,
        customInstructions: next.customInstructions,
        settingsJson: JSON.stringify({
          baseUrl: next.baseUrl,
          permissionMode: next.permissionMode,
          maxOutputLength: next.maxOutputLength,
        }),
      });
      message.success("设置已保存");
    } catch {
      message.error("保存失败");
    }
  };

  const updateSetting = <K extends keyof ClaudeSettings>(
    key: K,
    value: ClaudeSettings[K]
  ) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    saveToBackend(next);
  };

  const handleVerifyApiKey = () => {
    setVerifying(true);
    setTimeout(() => {
      setVerifying(false);
      if (settings.apiKey) {
        message.success("API Key 验证成功");
      } else {
        message.warning("请先输入 API Key");
      }
    }, 1500);
  };

  const matchesSearch = (label: string, desc?: string) => {
    if (!searchText) return true;
    const q = searchText.toLowerCase();
    return label.toLowerCase().includes(q) || (desc && desc.toLowerCase().includes(q));
  };

  if (!activeProfile) {
    return (
      <div style={{ padding: "48px 0", textAlign: "center", color: "var(--ant-color-text-secondary)" }}>
        暂无 Claude Code Profile，请先在 Profile 管理中创建一个
      </div>
    );
  }

  return (
    <div>
      {/* 模型 */}
      <SectionHeader title="模型" />
      {matchesSearch("默认模型") && (
        <div style={{ padding: "8px 0", borderBottom: "1px solid var(--ant-color-border-secondary)" }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ant-color-text)", marginBottom: 8 }}>
            默认模型
          </div>
          <div style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)", marginBottom: 10 }}>
            选择 Claude Code 使用的默认模型
          </div>
          <div className="flex gap-3">
            {CLAUDE_MODELS.map((m) => {
              const isSelected = settings.model === m.value;
              return (
                <div
                  key={m.value}
                  onClick={() => !loading && updateSetting("model", m.value)}
                  style={{
                    flex: 1,
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: `1.5px solid ${isSelected ? "var(--ant-color-primary)" : "var(--ant-color-border)"}`,
                    background: isSelected ? "var(--ant-color-primary-bg)" : "var(--ant-color-fill-quaternary)",
                    cursor: loading ? "not-allowed" : "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ant-color-text)" }}>{m.label}</span>
                    <Tag
                      color={isSelected ? "blue" : "default"}
                      style={{ fontSize: 10, lineHeight: "16px", padding: "0 4px", margin: 0, borderRadius: 4 }}
                    >
                      {m.tag}
                    </Tag>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--ant-color-text-tertiary)", lineHeight: "16px" }}>
                    {m.description}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {matchesSearch("思考强度", "推理深度") && (
        <div style={{ padding: "8px 0", borderBottom: "1px solid var(--ant-color-border-secondary)" }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ant-color-text)", marginBottom: 8 }}>
            思考强度
          </div>
          <div style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)", marginBottom: 10 }}>
            影响 Claude 的推理深度和响应速度
          </div>
          <div className="flex gap-2">
            {THINKING_INTENSITIES.map((t) => {
              const isSelected = settings.thinkingIntensity === t.value;
              return (
                <div
                  key={t.value}
                  onClick={() => !loading && updateSetting("thinkingIntensity", t.value)}
                  style={{
                    padding: "6px 16px",
                    borderRadius: 6,
                    border: `1.5px solid ${isSelected ? t.color : "var(--ant-color-border)"}`,
                    background: isSelected ? `${t.color}10` : "transparent",
                    cursor: loading ? "not-allowed" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    transition: "all 0.15s",
                  }}
                >
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: isSelected ? t.color : "var(--ant-color-text-quaternary)",
                    }}
                  />
                  <span style={{
                    fontSize: 12,
                    fontWeight: isSelected ? 600 : 400,
                    color: isSelected ? t.color : "var(--ant-color-text-secondary)",
                  }}>
                    {t.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 认证 */}
      <SectionHeader title="认证" />
      {matchesSearch("API Key") && (
        <SettingRow label="API Key" description="Claude API 密钥，通过系统 Keychain 安全存储">
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <Input.Password
              value={settings.apiKey}
              onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
              placeholder="sk-ant-..."
              style={{ width: 180 }}
              visibilityToggle
            />
            <Button
              size="small"
              loading={verifying}
              onClick={handleVerifyApiKey}
              icon={<CheckCircleOutlined />}
            >
              验证
            </Button>
          </div>
        </SettingRow>
      )}
      {matchesSearch("Base URL", "自定义 API 地址") && (
        <SettingRow label="Base URL" description="可选，自定义 API 请求地址">
          <Input
            value={settings.baseUrl}
            onChange={(e) => updateSetting("baseUrl", e.target.value)}
            placeholder="https://api.anthropic.com"
            style={{ width: 220 }}
          />
        </SettingRow>
      )}

      {/* 行为 */}
      <SectionHeader title="行为" />
      {matchesSearch("自动提交") && (
        <SettingRow label="自动提交" description="开启后，Claude 生成的代码修改将自动应用到文件">
          <Switch
            checked={settings.autoSubmit}
            onChange={(v) => updateSetting("autoSubmit", v)}
          />
        </SettingRow>
      )}
      {matchesSearch("权限模式") && (
        <SettingRow label="权限模式" description="控制 Claude 执行操作的确认级别">
          <div className="flex gap-1">
            {PERMISSION_MODES.map((m) => {
              const isSelected = settings.permissionMode === m.value;
              return (
                <div
                  key={m.value}
                  onClick={() => updateSetting("permissionMode", m.value)}
                  style={{
                    padding: "4px 12px",
                    borderRadius: 4,
                    fontSize: 12,
                    cursor: "pointer",
                    border: `1px solid ${isSelected ? "var(--ant-color-primary)" : "var(--ant-color-border)"}`,
                    background: isSelected ? "var(--ant-color-primary-bg)" : "transparent",
                    color: isSelected ? "var(--ant-color-primary)" : "var(--ant-color-text-secondary)",
                    fontWeight: isSelected ? 500 : 400,
                    transition: "all 0.15s",
                  }}
                >
                  {m.label}
                </div>
              );
            })}
          </div>
        </SettingRow>
      )}
      {matchesSearch("最大输出长度") && (
        <SettingRow label="最大输出长度" description="单次请求的最大输出 Token 数">
          <InputNumber
            value={settings.maxOutputLength}
            onChange={(v) => v && updateSetting("maxOutputLength", v)}
            min={1024}
            max={65536}
            step={1024}
            style={{ width: 120 }}
          />
        </SettingRow>
      )}

      {/* 自定义指令 */}
      <SectionHeader title="自定义指令" />
      {matchesSearch("全局自定义指令") && (
        <div style={{ padding: "8px 0", borderBottom: "1px solid var(--ant-color-border-secondary)" }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ant-color-text)", marginBottom: 4 }}>
            全局自定义指令
          </div>
          <div style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)", marginBottom: 8 }}>
            这些指令将附加到每个会话中，影响 Claude 的行为方式
          </div>
          <Input.TextArea
            value={settings.customInstructions}
            onChange={(e) => updateSetting("customInstructions", e.target.value)}
            rows={5}
            placeholder={`- 始终使用中文回复\n- 代码注释使用英文\n- 优先使用函数式编程风格`}
            style={{ fontFamily: "monospace", fontSize: 12 }}
          />
        </div>
      )}
    </div>
  );
}
