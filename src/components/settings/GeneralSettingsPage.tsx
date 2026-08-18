import { useState, useEffect } from "react";
import { Select, Switch, Slider, message } from "antd";
import { BUILT_IN_THEMES } from "../../themes";
import { useAppStore } from "../../stores/appStore";
import SettingRow from "./components/SettingRow";
import SectionHeader from "./components/SectionHeader";

interface GeneralSettings {
  language: string;
  theme: string;
  fontSize: number;
  uiZoom: number;
  restoreOnStartup: boolean;
  closeBehavior: string;
  showTrayIcon: boolean;
  autoStart: boolean;
  autoCheckUpdate: boolean;
  autoDownloadUpdate: boolean;
  compactMode: boolean;
  showStatusBar: boolean;
}

const DEFAULT_SETTINGS: GeneralSettings = {
  language: "zh",
  theme: "system",
  fontSize: 14,
  uiZoom: 100,
  restoreOnStartup: true,
  closeBehavior: "minimize",
  showTrayIcon: true,
  autoStart: false,
  autoCheckUpdate: true,
  autoDownloadUpdate: false,
  compactMode: false,
  showStatusBar: true,
};

interface GeneralSettingsPageProps {
  searchText?: string;
}

export default function GeneralSettingsPage({ searchText = "" }: GeneralSettingsPageProps) {
  const [settings, setSettings] = useState<GeneralSettings>(DEFAULT_SETTINGS);
  const compactMode = useAppStore((s) => s.compactMode);
  const toggleCompactMode = useAppStore((s) => s.toggleCompactMode);
  const appTheme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("teacoder_general_settings");
      const saved = raw ? JSON.parse(raw) : {};
      setSettings({ ...DEFAULT_SETTINGS, ...saved });
    } catch {
      setSettings(DEFAULT_SETTINGS);
    }
  }, []);

  const updateSetting = <K extends keyof GeneralSettings>(
    key: K,
    value: GeneralSettings[K]
  ) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    localStorage.setItem("teacoder_general_settings", JSON.stringify(next));
    if (key === "compactMode") {
      toggleCompactMode();
    }
    if (key === "theme") {
      setTheme(value as string);
    }
    message.success("设置已保存");
  };

  const matchesSearch = (label: string, desc?: string) => {
    if (!searchText) return true;
    const q = searchText.toLowerCase();
    return label.toLowerCase().includes(q) || (desc && desc.toLowerCase().includes(q));
  };

  return (
    <div>
      {/* 外观 */}
      <SectionHeader title="外观" />
      {matchesSearch("语言") && (
        <SettingRow label="语言" description="选择界面显示语言">
          <Select
            value={settings.language}
            onChange={(v) => updateSetting("language", v)}
            style={{ width: 160 }}
          >
            <Select.Option value="zh">简体中文</Select.Option>
            <Select.Option value="en">English</Select.Option>
          </Select>
        </SettingRow>
      )}
      {matchesSearch("主题", "深色/浅色/跟随系统") && (
        <SettingRow label="主题" description="选择应用主题外观">
          <div
            className="flex gap-2 overflow-x-auto pb-2"
            style={{ maxWidth: 600 }}
          >
            {BUILT_IN_THEMES.map((t) => {
              const isSelected = appTheme === t.key;
              return (
                <div
                  key={t.key}
                  onClick={() => updateSetting("theme", t.key)}
                  className="flex-shrink-0 cursor-pointer rounded-lg border-2 p-2 transition-all hover:border-[var(--ant-color-primary-border)]"
                  style={{
                    borderColor: isSelected ? "var(--ant-color-primary)" : "var(--ant-color-border-secondary)",
                    backgroundColor: isSelected ? "var(--ant-color-primary-bg)" : "transparent",
                    minWidth: 90,
                  }}
                >
                  {/* Color preview */}
                  <div
                    className="flex gap-0.5 rounded mb-1"
                    style={{
                      height: 24,
                      alignItems: "center",
                      justifyContent: "center",
                      background: `linear-gradient(135deg, ${t.previewColors[0]} 30%, ${t.previewColors[1]} 70%)`,
                    }}
                  >
                    <span
                      style={{
                        display: "inline-block",
                        width: 8,
                        height: 8,
                        borderRadius: 1,
                        backgroundColor: t.previewColors[2],
                      }}
                    />
                  </div>
                  {/* Theme name */}
                  <div
                    className="text-center text-xs truncate"
                    style={{
                      color: isSelected ? "var(--ant-color-primary)" : "var(--ant-color-text-secondary)",
                      fontWeight: isSelected ? 600 : 400,
                    }}
                  >
                    {t.label}
                  </div>
                </div>
              );
            })}
          </div>
        </SettingRow>
      )}
      {matchesSearch("字体大小") && (
        <SettingRow label="字体大小" description="调整界面字体大小">
          <div style={{ width: 200, display: "flex", alignItems: "center", gap: 8 }}>
            <Slider
              min={10}
              max={20}
              step={1}
              value={settings.fontSize}
              onChange={(v) => updateSetting("fontSize", v)}
              style={{ flex: 1, margin: 0 }}
            />
            <span style={{ fontSize: 12, color: "var(--ant-color-text-secondary)", minWidth: 24, textAlign: "right" }}>
              {settings.fontSize}
            </span>
          </div>
        </SettingRow>
      )}
      {matchesSearch("界面缩放") && (
        <SettingRow label="界面缩放" description="调整整体界面缩放比例">
          <div style={{ width: 200, display: "flex", alignItems: "center", gap: 8 }}>
            <Slider
              min={80}
              max={200}
              step={10}
              value={settings.uiZoom}
              onChange={(v) => updateSetting("uiZoom", v)}
              style={{ flex: 1, margin: 0 }}
            />
            <span style={{ fontSize: 12, color: "var(--ant-color-text-secondary)", minWidth: 32, textAlign: "right" }}>
              {settings.uiZoom}%
            </span>
          </div>
        </SettingRow>
      )}

      {/* 启动与关闭 */}
      <SectionHeader title="启动与关闭" />
      {matchesSearch("启动时恢复上次会话") && (
        <SettingRow label="启动时恢复上次会话" description="重新打开上次关闭时的会话标签页">
          <Switch
            checked={settings.restoreOnStartup}
            onChange={(v) => updateSetting("restoreOnStartup", v)}
          />
        </SettingRow>
      )}
      {matchesSearch("关闭窗口行为") && (
        <SettingRow label="关闭窗口行为" description="点击关闭按钮时的行为">
          <Select
            value={settings.closeBehavior}
            onChange={(v) => updateSetting("closeBehavior", v)}
            style={{ width: 160 }}
          >
            <Select.Option value="minimize">最小化到托盘</Select.Option>
            <Select.Option value="exit">退出应用</Select.Option>
          </Select>
        </SettingRow>
      )}
      {matchesSearch("显示托盘图标") && (
        <SettingRow label="显示托盘图标" description="在系统托盘显示应用图标">
          <Switch
            checked={settings.showTrayIcon}
            onChange={(v) => updateSetting("showTrayIcon", v)}
          />
        </SettingRow>
      )}
      {matchesSearch("开机自启动") && (
        <SettingRow label="开机自启动" description="系统启动时自动运行应用">
          <Switch
            checked={settings.autoStart}
            onChange={(v) => updateSetting("autoStart", v)}
          />
        </SettingRow>
      )}

      {/* 更新 */}
      <SectionHeader title="更新" />
      {matchesSearch("自动检查更新") && (
        <SettingRow label="自动检查更新" description="定期检查新版本">
          <Switch
            checked={settings.autoCheckUpdate}
            onChange={(v) => updateSetting("autoCheckUpdate", v)}
          />
        </SettingRow>
      )}
      {matchesSearch("自动下载更新") && (
        <SettingRow label="自动下载更新" description="发现新版本时自动下载">
          <Switch
            checked={settings.autoDownloadUpdate}
            onChange={(v) => updateSetting("autoDownloadUpdate", v)}
          />
        </SettingRow>
      )}

      {/* 布局 */}
      <SectionHeader title="布局" />
      {matchesSearch("紧凑模式", "减小间距和圆角") && (
        <SettingRow label="紧凑模式" description="减小间距和圆角，更接近 IDE 风格">
          <Switch
            checked={compactMode}
            onChange={toggleCompactMode}
          />
        </SettingRow>
      )}
      {matchesSearch("显示状态栏") && (
        <SettingRow label="显示状态栏" description="在窗口底部显示状态信息栏">
          <Switch
            checked={settings.showStatusBar}
            onChange={(v) => updateSetting("showStatusBar", v)}
          />
        </SettingRow>
      )}
    </div>
  );
}
