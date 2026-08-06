import { useState, useEffect } from "react";
import { message } from "antd";
import KeyBindingInput from "./components/KeyBindingInput";
import SettingRow from "./components/SettingRow";
import SectionHeader from "./components/SectionHeader";

interface KeybindingsSettings {
  showHideWindow: string;
  newSession: string;
  closeSession: string;
  terminalCopy: string;
  terminalPaste: string;
  terminalClear: string;
  terminalSearch: string;
  editUndo: string;
  editRedo: string;
}

const DEFAULT_SETTINGS: KeybindingsSettings = {
  showHideWindow: "Ctrl+Shift+T",
  newSession: "Ctrl+N",
  closeSession: "Ctrl+W",
  terminalCopy: "Ctrl+Shift+C",
  terminalPaste: "Ctrl+Shift+V",
  terminalClear: "Ctrl+L",
  terminalSearch: "Ctrl+Shift+F",
  editUndo: "Ctrl+Z",
  editRedo: "Ctrl+Shift+Z",
};

interface KeybindingsPageProps {
  searchText?: string;
}

export default function KeybindingsPage({ searchText = "" }: KeybindingsPageProps) {
  const [settings, setSettings] = useState<KeybindingsSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("codingtea_keybindings_settings");
      const saved = raw ? JSON.parse(raw) : {};
      setSettings({ ...DEFAULT_SETTINGS, ...saved });
    } catch {
      setSettings(DEFAULT_SETTINGS);
    }
  }, []);

  const updateSetting = <K extends keyof KeybindingsSettings>(
    key: K,
    value: KeybindingsSettings[K]
  ) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    localStorage.setItem("codingtea_keybindings_settings", JSON.stringify(next));
    message.success("设置已保存");
  };

  const matchesSearch = (label: string, desc?: string) => {
    if (!searchText) return true;
    const q = searchText.toLowerCase();
    return label.toLowerCase().includes(q) || (desc && desc.toLowerCase().includes(q));
  };

  return (
    <div>
      {/* 全局快捷键 */}
      <SectionHeader title="全局快捷键" />
      {matchesSearch("显示/隐藏窗口") && (
        <SettingRow label="显示/隐藏窗口" description="全局快捷键切换窗口显示状态">
          <KeyBindingInput
            value={settings.showHideWindow}
            onChange={(v) => updateSetting("showHideWindow", v)}
          />
        </SettingRow>
      )}
      {matchesSearch("新建会话") && (
        <SettingRow label="新建会话" description="创建新的终端会话">
          <KeyBindingInput
            value={settings.newSession}
            onChange={(v) => updateSetting("newSession", v)}
          />
        </SettingRow>
      )}
      {matchesSearch("关闭会话") && (
        <SettingRow label="关闭会话" description="关闭当前终端会话">
          <KeyBindingInput
            value={settings.closeSession}
            onChange={(v) => updateSetting("closeSession", v)}
          />
        </SettingRow>
      )}

      {/* 终端快捷键 */}
      <SectionHeader title="终端快捷键" />
      {matchesSearch("复制") && (
        <SettingRow label="复制" description="复制终端选中内容">
          <KeyBindingInput
            value={settings.terminalCopy}
            onChange={(v) => updateSetting("terminalCopy", v)}
          />
        </SettingRow>
      )}
      {matchesSearch("粘贴") && (
        <SettingRow label="粘贴" description="粘贴内容到终端">
          <KeyBindingInput
            value={settings.terminalPaste}
            onChange={(v) => updateSetting("terminalPaste", v)}
          />
        </SettingRow>
      )}
      {matchesSearch("清屏") && (
        <SettingRow label="清屏" description="清除终端屏幕内容">
          <KeyBindingInput
            value={settings.terminalClear}
            onChange={(v) => updateSetting("terminalClear", v)}
          />
        </SettingRow>
      )}
      {matchesSearch("搜索") && (
        <SettingRow label="搜索" description="在终端中搜索文本">
          <KeyBindingInput
            value={settings.terminalSearch}
            onChange={(v) => updateSetting("terminalSearch", v)}
          />
        </SettingRow>
      )}

      {/* 编辑快捷键 */}
      <SectionHeader title="编辑快捷键" />
      {matchesSearch("撤销") && (
        <SettingRow label="撤销" description="撤销上一步操作">
          <KeyBindingInput
            value={settings.editUndo}
            onChange={(v) => updateSetting("editUndo", v)}
          />
        </SettingRow>
      )}
      {matchesSearch("重做") && (
        <SettingRow label="重做" description="重做已撤销的操作">
          <KeyBindingInput
            value={settings.editRedo}
            onChange={(v) => updateSetting("editRedo", v)}
          />
        </SettingRow>
      )}
    </div>
  );
}
