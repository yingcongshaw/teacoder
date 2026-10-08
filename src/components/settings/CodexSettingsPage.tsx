import { useState, useEffect } from "react";
import { Select, Switch, App } from "antd";
import SettingRow from "./components/SettingRow";
import SectionHeader from "./components/SectionHeader";
import QuickCommandsEditor from "../quick-commands/QuickCommandsEditor";


const SANDBOX_MODES = [
  { value: "disabled", label: "禁用" },
  { value: "strict", label: "严格" },
  { value: "relaxed", label: "宽松" },
];

interface CodexSettings {
  model: string;
  autoApprove: boolean;
  sandboxMode: string;
}

const DEFAULT_SETTINGS: CodexSettings = {
  model: "codex-1",
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