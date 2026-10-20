import { useState, useEffect } from "react";
import { Select, Switch, Input, App } from "antd";
import SettingRow from "./components/SettingRow";
import SectionHeader from "./components/SectionHeader";
import QuickCommandsEditor from "../quick-commands/QuickCommandsEditor";

const ANTIGRAVITY_MODELS = [
  { value: "antigravity-1", label: "Antigravity 1", description: "完整能力，适合复杂任务" },
  { value: "antigravity-lite", label: "Antigravity Lite", description: "轻量快速，适合日常任务" },
];

interface AntigravitySettings {
  apiKey: string;
  endpoint: string;
  model: string;
  autoCommit: boolean;
}

const DEFAULT_SETTINGS: AntigravitySettings = {
  apiKey: "",
  endpoint: "",
  model: "antigravity-1",
  autoCommit: false,
};

interface AntigravitySettingsPageProps {
  searchText?: string;
}

export default function AntigravitySettingsPage({ searchText = "" }: AntigravitySettingsPageProps) {
  const { message } = App.useApp();
  const [settings, setSettings] = useState<AntigravitySettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("teacoder_antigravity_settings");
      const saved = raw ? JSON.parse(raw) : {};
      setSettings({ ...DEFAULT_SETTINGS, ...saved });
    } catch {
      setSettings(DEFAULT_SETTINGS);
    }
  }, []);

  const updateSetting = <K extends keyof AntigravitySettings>(
    key: K,
    value: AntigravitySettings[K]
  ) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    localStorage.setItem("teacoder_antigravity_settings", JSON.stringify(next));
    message.success("设置已保存");
  };

  const matchesSearch = (label: string, desc?: string) => {
    if (!searchText) return true;
    const q = searchText.toLowerCase();
    return label.toLowerCase().includes(q) || (desc && desc.toLowerCase().includes(q));
  };

  return (
    <div>
      {/* 认证 */}
      <SectionHeader title="认证" />
      {matchesSearch("API Key") && (
        <SettingRow label="API Key" description="Antigravity API 密钥，通过系统 Keychain 安全存储">
          <Input.Password
            value={settings.apiKey}
            onChange={(e) => updateSetting("apiKey", e.target.value)}
            placeholder="ag-..."
            style={{ width: 200 }}
          />
        </SettingRow>
      )}
      {matchesSearch("Endpoint", "端点地址") && (
        <SettingRow label="Endpoint" description="可选，自定义 API 端点地址">
          <Input
            value={settings.endpoint}
            onChange={(e) => updateSetting("endpoint", e.target.value)}
            placeholder="https://..."
            style={{ width: 240 }}
          />
        </SettingRow>
      )}

      {/* 行为 */}
      <SectionHeader title="行为" />
      {matchesSearch("默认模型") && (
        <SettingRow label="默认模型" description="选择 Antigravity 使用的默认模型">
          <Select
            value={settings.model}
            onChange={(v) => updateSetting("model", v)}
            style={{ width: 220 }}
          >
            {ANTIGRAVITY_MODELS.map((m) => (
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
      {matchesSearch("自动提交") && (
        <SettingRow label="自动提交" description="开启后，Antigravity 生成的代码修改将自动提交">
          <Switch
            checked={settings.autoCommit}
            onChange={(v) => updateSetting("autoCommit", v)}
          />
        </SettingRow>
      )}

      {matchesSearch("快捷命令") && <QuickCommandsEditor toolType="antigravity" />}
    </div>
  );
}
