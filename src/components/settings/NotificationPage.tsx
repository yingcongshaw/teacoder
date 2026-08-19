import { useState, useEffect } from "react";
import { Switch, InputNumber, message } from "antd";
import SettingRow from "./components/SettingRow";
import SectionHeader from "./components/SectionHeader";

interface NotificationSettings {
  enableDesktop: boolean;
  enableSound: boolean;
  sessionComplete: boolean;
  errorOccur: boolean;
  costWarning: boolean;
  costWarningThreshold: number;
  versionUpdate: boolean;
}

const DEFAULT_SETTINGS: NotificationSettings = {
  enableDesktop: true,
  enableSound: false,
  sessionComplete: true,
  errorOccur: true,
  costWarning: true,
  costWarningThreshold: 10,
  versionUpdate: true,
};

interface NotificationPageProps {
  searchText?: string;
}

export default function NotificationPage({ searchText = "" }: NotificationPageProps) {
  const [settings, setSettings] = useState<NotificationSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("teacoder_notification_settings");
      const saved = raw ? JSON.parse(raw) : {};
      setSettings({ ...DEFAULT_SETTINGS, ...saved });
    } catch {
      setSettings(DEFAULT_SETTINGS);
    }
  }, []);

  const updateSetting = <K extends keyof NotificationSettings>(
    key: K,
    value: NotificationSettings[K]
  ) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    localStorage.setItem("teacoder_notification_settings", JSON.stringify(next));
    message.success("设置已保存");
  };

  const matchesSearch = (label: string, desc?: string) => {
    if (!searchText) return true;
    const q = searchText.toLowerCase();
    return label.toLowerCase().includes(q) || (desc && desc.toLowerCase().includes(q));
  };

  return (
    <div>
      {/* 通知方式 */}
      <SectionHeader title="通知方式" />
      {matchesSearch("启用桌面通知") && (
        <SettingRow label="启用桌面通知" description="通过系统通知中心推送消息">
          <Switch
            checked={settings.enableDesktop}
            onChange={(v) => updateSetting("enableDesktop", v)}
          />
        </SettingRow>
      )}
      {matchesSearch("启用声音") && (
        <SettingRow label="启用声音" description="通知时播放提示音">
          <Switch
            checked={settings.enableSound}
            onChange={(v) => updateSetting("enableSound", v)}
          />
        </SettingRow>
      )}

      {/* 通知事件 */}
      <SectionHeader title="通知事件" />
      {matchesSearch("会话完成") && (
        <SettingRow label="会话完成" description="CLI 会话执行完成时通知">
          <Switch
            checked={settings.sessionComplete}
            onChange={(v) => updateSetting("sessionComplete", v)}
          />
        </SettingRow>
      )}
      {matchesSearch("错误发生") && (
        <SettingRow label="错误发生" description="CLI 执行出错时通知">
          <Switch
            checked={settings.errorOccur}
            onChange={(v) => updateSetting("errorOccur", v)}
          />
        </SettingRow>
      )}
      {matchesSearch("费用预警") && (
        <SettingRow label="费用预警" description="Token 费用超过阈值时通知">
          <Switch
            checked={settings.costWarning}
            onChange={(v) => updateSetting("costWarning", v)}
          />
        </SettingRow>
      )}
      {matchesSearch("费用预警阈值") && settings.costWarning && (
        <SettingRow label="费用预警阈值" description="触发费用预警的金额" indent>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <InputNumber
              min={1}
              max={1000}
              value={settings.costWarningThreshold}
              onChange={(v) => updateSetting("costWarningThreshold", v ?? 10)}
              style={{ width: 80 }}
            />
            <span style={{ fontSize: 12, color: "var(--ant-color-text-secondary)" }}>USD</span>
          </div>
        </SettingRow>
      )}
      {matchesSearch("版本更新") && (
        <SettingRow label="版本更新" description="有新版本可用时通知">
          <Switch
            checked={settings.versionUpdate}
            onChange={(v) => updateSetting("versionUpdate", v)}
          />
        </SettingRow>
      )}
    </div>
  );
}
