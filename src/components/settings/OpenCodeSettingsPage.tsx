import { useState, useEffect } from "react";
import { Select, Switch, Input, message } from "antd";
import SettingRow from "./components/SettingRow";
import SectionHeader from "./components/SectionHeader";

const OPENCODE_MODELS = [
  { value: "gpt-4o", label: "GPT-4o", description: "最强代码生成能力" },
  { value: "gpt-4o-mini", label: "GPT-4o Mini", description: "高效推理，适合日常任务" },
  { value: "o3-mini", label: "o3-mini", description: "快速推理，适合简单任务" },
];

const PROVIDERS = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "local", label: "Local" },
];

interface OpenCodeSettings {
  model: string;
  provider: string;
  apiKey: string;
  baseUrl: string;
  autoExecute: boolean;
}

const DEFAULT_SETTINGS: OpenCodeSettings = {
  model: "gpt-4o",
  provider: "openai",
  apiKey: "",
  baseUrl: "",
  autoExecute: false,
};

interface OpenCodeSettingsPageProps {
  searchText?: string;
}

export default function OpenCodeSettingsPage({ searchText = "" }: OpenCodeSettingsPageProps) {
  const [settings, setSettings] = useState<OpenCodeSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("teacoder_opencode_settings");
      const saved = raw ? JSON.parse(raw) : {};
      setSettings({ ...DEFAULT_SETTINGS, ...saved });
    } catch {
      setSettings(DEFAULT_SETTINGS);
    }
  }, []);

  const updateSetting = <K extends keyof OpenCodeSettings>(
    key: K,
    value: OpenCodeSettings[K]
  ) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    localStorage.setItem("teacoder_opencode_settings", JSON.stringify(next));
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
        <SettingRow label="默认模型" description="选择 OpenCode 使用的默认模型">
          <Select
            value={settings.model}
            onChange={(v) => updateSetting("model", v)}
            style={{ width: 220 }}
          >
            {OPENCODE_MODELS.map((m) => (
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
      {matchesSearch("Provider", "提供商") && (
        <SettingRow label="Provider" description="选择 API 提供商">
          <Select
            value={settings.provider}
            onChange={(v) => updateSetting("provider", v)}
            style={{ width: 160 }}
          >
            {PROVIDERS.map((p) => (
              <Select.Option key={p.value} value={p.value}>{p.label}</Select.Option>
            ))}
          </Select>
        </SettingRow>
      )}

      {/* 认证 */}
      <SectionHeader title="认证" />
      {matchesSearch("API Key") && (
        <SettingRow label="API Key" description="API 密钥，通过系统 Keychain 安全存储">
          <Input.Password
            value={settings.apiKey}
            onChange={(e) => updateSetting("apiKey", e.target.value)}
            placeholder="sk-..."
            style={{ width: 200 }}
          />
        </SettingRow>
      )}
      {matchesSearch("Base URL", "自定义 API 地址") && (
        <SettingRow label="Base URL" description="可选，自定义 API 请求地址">
          <Input
            value={settings.baseUrl}
            onChange={(e) => updateSetting("baseUrl", e.target.value)}
            placeholder="https://api.openai.com/v1"
            style={{ width: 240 }}
          />
        </SettingRow>
      )}

      {/* 行为 */}
      <SectionHeader title="行为" />
      {matchesSearch("自动执行") && (
        <SettingRow label="自动执行" description="开启后，OpenCode 生成的操作将自动执行">
          <Switch
            checked={settings.autoExecute}
            onChange={(v) => updateSetting("autoExecute", v)}
          />
        </SettingRow>
      )}
    </div>
  );
}
