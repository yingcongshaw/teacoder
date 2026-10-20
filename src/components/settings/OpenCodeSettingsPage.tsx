import { useState, useEffect } from "react";
import { Switch, App } from "antd";
import SettingRow from "./components/SettingRow";
import SectionHeader from "./components/SectionHeader";
import QuickCommandsEditor from "../quick-commands/QuickCommandsEditor";


interface OpenCodeSettings {
  model: string;
  autoExecute: boolean;
}

const DEFAULT_SETTINGS: OpenCodeSettings = {
  model: "gpt-4o",
  autoExecute: false,
};

interface OpenCodeSettingsPageProps {
  searchText?: string;
}

export default function OpenCodeSettingsPage({ searchText = "" }: OpenCodeSettingsPageProps) {
  const { message } = App.useApp();
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