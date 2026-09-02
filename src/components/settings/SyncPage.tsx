import { useState, useEffect } from "react";
import { Select, Switch, Input, App } from "antd";
import SettingRow from "./components/SettingRow";
import SectionHeader from "./components/SectionHeader";

interface SyncSettings {
  enableSync: boolean;
  syncMethod: string;
  syncAddress: string;
  autoSync: boolean;
  syncInterval: string;
  syncGeneral: boolean;
  syncTerminal: boolean;
  syncKeybindings: boolean;
  syncProfile: boolean;
}

const DEFAULT_SETTINGS: SyncSettings = {
  enableSync: false,
  syncMethod: "webdav",
  syncAddress: "",
  autoSync: false,
  syncInterval: "15min",
  syncGeneral: true,
  syncTerminal: true,
  syncKeybindings: true,
  syncProfile: false,
};

interface SyncPageProps {
  searchText?: string;
}

export default function SyncPage({ searchText = "" }: SyncPageProps) {
  const { message } = App.useApp();
  const [settings, setSettings] = useState<SyncSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("teacoder_sync_settings");
      const saved = raw ? JSON.parse(raw) : {};
      setSettings({ ...DEFAULT_SETTINGS, ...saved });
    } catch {
      setSettings(DEFAULT_SETTINGS);
    }
  }, []);

  const updateSetting = <K extends keyof SyncSettings>(
    key: K,
    value: SyncSettings[K]
  ) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    localStorage.setItem("teacoder_sync_settings", JSON.stringify(next));
    message.success("设置已保存");
  };

  const matchesSearch = (label: string, desc?: string) => {
    if (!searchText) return true;
    const q = searchText.toLowerCase();
    return label.toLowerCase().includes(q) || (desc && desc.toLowerCase().includes(q));
  };

  return (
    <div>
      {/* 设置同步 */}
      <SectionHeader title="设置同步" />
      {matchesSearch("启用设置同步") && (
        <SettingRow label="启用设置同步" description="在多台设备间同步应用设置">
          <Switch
            checked={settings.enableSync}
            onChange={(v) => updateSetting("enableSync", v)}
          />
        </SettingRow>
      )}
      {matchesSearch("同步方式") && settings.enableSync && (
        <SettingRow label="同步方式" description="选择设置同步的存储方式" indent>
          <Select
            value={settings.syncMethod}
            onChange={(v) => updateSetting("syncMethod", v)}
            style={{ width: 160 }}
          >
            <Select.Option value="webdav">WebDAV</Select.Option>
            <Select.Option value="git">Git</Select.Option>
            <Select.Option value="local">本地文件</Select.Option>
          </Select>
        </SettingRow>
      )}
      {matchesSearch("同步地址") && settings.enableSync && (
        <SettingRow label="同步地址" description="同步服务的 URL 或本地路径" indent>
          <Input
            value={settings.syncAddress}
            onChange={(e) => updateSetting("syncAddress", e.target.value)}
            placeholder={settings.syncMethod === "webdav" ? "https://dav.example.com/teacoder" : settings.syncMethod === "git" ? "https://github.com/user/repo" : "/path/to/sync/dir"}
            style={{ width: 280 }}
          />
        </SettingRow>
      )}
      {matchesSearch("自动同步") && settings.enableSync && (
        <SettingRow label="自动同步" description="定期自动同步设置" indent>
          <Switch
            checked={settings.autoSync}
            onChange={(v) => updateSetting("autoSync", v)}
          />
        </SettingRow>
      )}
      {matchesSearch("同步间隔") && settings.enableSync && settings.autoSync && (
        <SettingRow label="同步间隔" description="自动同步的时间间隔" indent>
          <Select
            value={settings.syncInterval}
            onChange={(v) => updateSetting("syncInterval", v)}
            style={{ width: 160 }}
          >
            <Select.Option value="5min">5 分钟</Select.Option>
            <Select.Option value="15min">15 分钟</Select.Option>
            <Select.Option value="30min">30 分钟</Select.Option>
            <Select.Option value="60min">60 分钟</Select.Option>
          </Select>
        </SettingRow>
      )}

      {/* 同步内容 */}
      <SectionHeader title="同步内容" />
      {matchesSearch("同步通用设置") && settings.enableSync && (
        <SettingRow label="同步通用设置" description="包含语言、主题、启动等通用设置" indent>
          <Switch
            checked={settings.syncGeneral}
            onChange={(v) => updateSetting("syncGeneral", v)}
          />
        </SettingRow>
      )}
      {matchesSearch("同步终端设置") && settings.enableSync && (
        <SettingRow label="同步终端设置" description="包含 Shell、字体、行为等终端设置" indent>
          <Switch
            checked={settings.syncTerminal}
            onChange={(v) => updateSetting("syncTerminal", v)}
          />
        </SettingRow>
      )}
      {matchesSearch("同步快捷键") && settings.enableSync && (
        <SettingRow label="同步快捷键" description="包含全局和终端快捷键配置" indent>
          <Switch
            checked={settings.syncKeybindings}
            onChange={(v) => updateSetting("syncKeybindings", v)}
          />
        </SettingRow>
      )}
      {matchesSearch("同步 Profile") && settings.enableSync && (
        <SettingRow label="同步 Profile" description="包含 API Key 等敏感信息" indent>
          <Switch
            checked={settings.syncProfile}
            onChange={(v) => updateSetting("syncProfile", v)}
          />
        </SettingRow>
      )}
    </div>
  );
}
