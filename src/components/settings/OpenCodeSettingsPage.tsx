import { useState, useEffect } from "react";
import { Select, Switch, Input, App } from "antd";
import SettingRow from "./components/SettingRow";
import SectionHeader from "./components/SectionHeader";
import QuickCommandsEditor from "../quick-commands/QuickCommandsEditor";
import CliArgsLlmList from "../cli/CliArgsLlmList";

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
  const { message } = App.useApp();
  const [settings, setSettings] = useState<OpenCodeSettings>(DEFAULT_SETTINGS);
  const [llmConfig, setLlmConfig] = useState<{
    llmProviderIds: string[];
    defaultLlmProviderId?: string;
  }>({ llmProviderIds: [] });

  useEffect(() => {
    try {
      const raw = localStorage.getItem("teacoder_opencode_settings");
      const saved = raw ? JSON.parse(raw) : {};
      setSettings({ ...DEFAULT_SETTINGS, ...saved });
    } catch {
      setSettings(DEFAULT_SETTINGS);
    }
    try {
      const llmRaw = localStorage.getItem("teacoder_opencode_llm_config");
      if (llmRaw) {
        const parsed = JSON.parse(llmRaw);
        setLlmConfig({
          llmProviderIds: parsed.llmProviderIds ?? [],
          defaultLlmProviderId: parsed.defaultLlmProviderId,
        });
      }
    } catch {
      // llm config 解析失败时保留默认
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

  const handleLlmConfigChange = (next: {
    llmProviderIds: string[];
    defaultLlmProviderId?: string;
  }) => {
    setLlmConfig(next);
    localStorage.setItem("teacoder_opencode_llm_config", JSON.stringify(next));
  };

  const matchesSearch = (label: string, desc?: string) => {
    if (!searchText) return true;
    const q = searchText.toLowerCase();
    return label.toLowerCase().includes(q) || (desc && desc.toLowerCase().includes(q));
  };

  return (
    <div>
      {/* LLM 供应商 */}
      <SectionHeader title="LLM 供应商" />
      {matchesSearch("LLM 供应商") && (
        <CliArgsLlmList
          toolType="opencode"
          value={llmConfig}
          onChange={handleLlmConfigChange}
        />
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

      {matchesSearch("快捷命令") && <QuickCommandsEditor toolType="opencode" />}
    </div>
  );
}