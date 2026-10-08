import { useState, useEffect } from "react";
import { Select, Switch, App } from "antd";
import SettingRow from "./components/SettingRow";
import SectionHeader from "./components/SectionHeader";
import QuickCommandsEditor from "../quick-commands/QuickCommandsEditor";


const SAFETY_LEVELS = [
  { value: "standard", label: "标准" },
  { value: "strict", label: "严格" },
];

interface GeminiSettings {
  model: string;
  autoExecute: boolean;
  safetyLevel: string;
}

const DEFAULT_SETTINGS: GeminiSettings = {
  model: "gemini-2.5-pro",
  autoExecute: false,
  safetyLevel: "standard",
};

interface GeminiSettingsPageProps {
  searchText?: string;
}

export default function GeminiSettingsPage({ searchText = "" }: GeminiSettingsPageProps) {
  const { message } = App.useApp();
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

      {matchesSearch("快捷命令") && <QuickCommandsEditor toolType="gemini" />}
    </div>
  );
}