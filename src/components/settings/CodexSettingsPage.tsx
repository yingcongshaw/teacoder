import { useState, useEffect } from "react";
import { Select, Switch, Input, App } from "antd";
import SettingRow from "./components/SettingRow";
import SectionHeader from "./components/SectionHeader";
import QuickCommandsEditor from "../quick-commands/QuickCommandsEditor";

const CODEX_MODELS = [
  { value: "codex-1", label: "Codex 1", description: "最强代码生成能力" },
  { value: "o3-mini", label: "o3-mini", description: "高效推理，适合日常任务" },
  { value: "o4-mini", label: "o4-mini", description: "快速响应，适合简单任务" },
];

const SANDBOX_MODES = [
  { value: "disabled", label: "禁用" },
  { value: "strict", label: "严格" },
  { value: "relaxed", label: "宽松" },
];

interface CodexSettings {
  model: string;
  apiKey: string;
  organizationId: string;
  autoApprove: boolean;
  sandboxMode: string;
}

const DEFAULT_SETTINGS: CodexSettings = {
  model: "codex-1",
  apiKey: "",
  organizationId: "",
  autoApprove: false,
  sandboxMode: "strict",
};

interface CodexSettingsPageProps {
  searchText?: string;
}

export default function CodexSettingsPage({ searchText = "" }: CodexSettingsPageProps) {
  const { message } = App.useApp();
  const [settings, setSettings] = useState<CodexSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("teacoder_codex_settings");
      const saved = raw ? JSON.parse(raw) : {};
      setSettings({ ...DEFAULT_SETTINGS, ...saved });
    } catch {
      setSettings(DEFAULT_SETTINGS);
    }
  }, []);

  const updateSetting = <K extends keyof CodexSettings>(
    key: K,
    value: CodexSettings[K]
  ) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    localStorage.setItem("teacoder_codex_settings", JSON.stringify(next));
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
        <SettingRow label="默认模型" description="选择 Codex CLI 使用的默认模型">
          <Select
            value={settings.model}
            onChange={(v) => updateSetting("model", v)}
            style={{ width: 220 }}
          >
            {CODEX_MODELS.map((m) => (
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
        <SettingRow label="API Key" description="OpenAI API 密钥，通过系统 Keychain 安全存储">
          <Input.Password
            value={settings.apiKey}
            onChange={(e) => updateSetting("apiKey", e.target.value)}
            placeholder="sk-..."
            style={{ width: 200 }}
          />
        </SettingRow>
      )}
      {matchesSearch("Organization ID", "组织 ID") && (
        <SettingRow label="Organization ID" description="可选，OpenAI 组织 ID">
          <Input
            value={settings.organizationId}
            onChange={(e) => updateSetting("organizationId", e.target.value)}
            placeholder="org-..."
            style={{ width: 240 }}
          />
        </SettingRow>
      )}

      {/* 行为 */}
      <SectionHeader title="行为" />
      {matchesSearch("自动批准") && (
        <SettingRow label="自动批准" description="开启后，Codex 生成的操作将自动批准执行">
          <Switch
            checked={settings.autoApprove}
            onChange={(v) => updateSetting("autoApprove", v)}
          />
        </SettingRow>
      )}
      {matchesSearch("沙箱模式") && (
        <SettingRow label="沙箱模式" description="控制 Codex 执行代码的沙箱隔离级别">
          <Select
            value={settings.sandboxMode}
            onChange={(v) => updateSetting("sandboxMode", v)}
            style={{ width: 120 }}
          >
            {SANDBOX_MODES.map((m) => (
              <Select.Option key={m.value} value={m.value}>{m.label}</Select.Option>
            ))}
          </Select>
        </SettingRow>
      )}

      {matchesSearch("快捷命令") && <QuickCommandsEditor toolType="codex" />}
    </div>
  );
}
