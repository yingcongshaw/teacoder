import { useState, useEffect } from "react";
import { Select, Switch, Input, message } from "antd";
import SettingRow from "./components/SettingRow";
import SectionHeader from "./components/SectionHeader";

const GEMINI_MODELS = [
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", description: "最强推理能力，适合复杂任务" },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", description: "快速响应，适合日常任务" },
];

const SAFETY_LEVELS = [
  { value: "standard", label: "标准" },
  { value: "strict", label: "严格" },
];

interface GeminiSettings {
  model: string;
  apiKey: string;
  googleCloudProject: string;
  autoExecute: boolean;
  safetyLevel: string;
}

const DEFAULT_SETTINGS: GeminiSettings = {
  model: "gemini-2.5-pro",
  apiKey: "",
  googleCloudProject: "",
  autoExecute: false,
  safetyLevel: "standard",
};

interface GeminiSettingsPageProps {
  searchText?: string;
}

export default function GeminiSettingsPage({ searchText = "" }: GeminiSettingsPageProps) {
  const [settings, setSettings] = useState<GeminiSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("teacoder_gemini_settings");
      const saved = raw ? JSON.parse(raw) : {};
      setSettings({ ...DEFAULT_SETTINGS, ...saved });
    } catch {
      setSettings(DEFAULT_SETTINGS);
    }
  }, []);

  const updateSetting = <K extends keyof GeminiSettings>(
    key: K,
    value: GeminiSettings[K]
  ) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    localStorage.setItem("teacoder_gemini_settings", JSON.stringify(next));
    message.success("设置已保存");
  };

  const matchesSearch = (label: string, desc?: string) => {
    if (!searchText) return true;
    const q = searchText.toLowerCase();
    return label.toLowerCase().includes(q) || (desc && desc.toLowerCase().includes(q));
  };

  return (
    <div>
      {/* 模型 */}
      <SectionHeader title="模型" />
      {matchesSearch("默认模型") && (
        <SettingRow label="默认模型" description="选择 Gemini CLI 使用的默认模型">
          <Select
            value={settings.model}
            onChange={(v) => updateSetting("model", v)}
            style={{ width: 220 }}
          >
            {GEMINI_MODELS.map((m) => (
              <Select.Option key={m.value} value={m.value}>
                <div className="flex flex-col">
                  <span className="font-medium">{m.label}</span>
                  <span style={{ fontSize: 11, color: "var(--ant-color-text-tertiary)" }}>{m.description}</span>
                </div>
              </Select.Option>
            ))}
          </Select>
        </SettingRow>
      )}

      {/* 认证 */}
      <SectionHeader title="认证" />
      {matchesSearch("API Key") && (
        <SettingRow label="API Key" description="Google AI API 密钥，通过系统 Keychain 安全存储">
          <Input.Password
            value={settings.apiKey}
            onChange={(e) => updateSetting("apiKey", e.target.value)}
            placeholder="AIza..."
            style={{ width: 200 }}
          />
        </SettingRow>
      )}
      {matchesSearch("Google Cloud Project", "云项目") && (
        <SettingRow label="Google Cloud Project" description="可选，Google Cloud 项目 ID">
          <Input
            value={settings.googleCloudProject}
            onChange={(e) => updateSetting("googleCloudProject", e.target.value)}
            placeholder="my-project-id"
            style={{ width: 240 }}
          />
        </SettingRow>
      )}

      {/* 行为 */}
      <SectionHeader title="行为" />
      {matchesSearch("自动执行") && (
        <SettingRow label="自动执行" description="开启后，Gemini 生成的操作将自动执行">
          <Switch
            checked={settings.autoExecute}
            onChange={(v) => updateSetting("autoExecute", v)}
          />
        </SettingRow>
      )}
      {matchesSearch("安全级别") && (
        <SettingRow label="安全级别" description="控制 Gemini 的内容安全过滤级别">
          <Select
            value={settings.safetyLevel}
            onChange={(v) => updateSetting("safetyLevel", v)}
            style={{ width: 120 }}
          >
            {SAFETY_LEVELS.map((l) => (
              <Select.Option key={l.value} value={l.value}>{l.label}</Select.Option>
            ))}
          </Select>
        </SettingRow>
      )}
    </div>
  );
}
