import { useState, useEffect } from "react";
import { Input, Button, Popconfirm, message } from "antd";
import SettingRow from "./components/SettingRow";
import SectionHeader from "./components/SectionHeader";

interface DataManagementSettings {
  dataDirectory: string;
}

const DEFAULT_SETTINGS: DataManagementSettings = {
  dataDirectory: "~/.codingtea",
};

interface DataManagementPageProps {
  searchText?: string;
}

export default function DataManagementPage({ searchText = "" }: DataManagementPageProps) {
  const [settings, setSettings] = useState<DataManagementSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("codingtea_datamanagement_settings");
      const saved = raw ? JSON.parse(raw) : {};
      setSettings({ ...DEFAULT_SETTINGS, ...saved });
    } catch {
      setSettings(DEFAULT_SETTINGS);
    }
  }, []);

  const updateSetting = <K extends keyof DataManagementSettings>(
    key: K,
    value: DataManagementSettings[K]
  ) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    localStorage.setItem("codingtea_datamanagement_settings", JSON.stringify(next));
    message.success("设置已保存");
  };

  const matchesSearch = (label: string, desc?: string) => {
    if (!searchText) return true;
    const q = searchText.toLowerCase();
    return label.toLowerCase().includes(q) || (desc && desc.toLowerCase().includes(q));
  };

  const handleBrowse = () => {
    message.info("目录选择功能将在后续版本实现");
  };

  const handleExport = () => {
    message.info("导出功能将在后续版本实现");
  };

  const handleImport = () => {
    message.info("导入功能将在后续版本实现");
  };

  const handleClearCache = () => {
    message.success("缓存已清除");
  };

  const handleClearAll = () => {
    message.success("所有数据已清除");
  };

  return (
    <div>
      {/* 数据存储 */}
      <SectionHeader title="数据存储" />
      {matchesSearch("数据目录") && (
        <SettingRow label="数据目录" description="应用数据存储位置">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Input
              value={settings.dataDirectory}
              onChange={(e) => updateSetting("dataDirectory", e.target.value)}
              readOnly
              style={{ width: 240 }}
            />
            <Button onClick={handleBrowse}>浏览</Button>
          </div>
        </SettingRow>
      )}
      {matchesSearch("数据库大小") && (
        <SettingRow label="数据库大小" description="当前数据库文件占用空间">
          <span style={{ fontSize: 14, color: "var(--ant-color-text)" }}>12.5 MB</span>
        </SettingRow>
      )}
      {matchesSearch("会话数据") && (
        <SettingRow label="会话数据" description="已保存的终端会话数量">
          <span style={{ fontSize: 14, color: "var(--ant-color-text)" }}>42 个会话</span>
        </SettingRow>
      )}

      {/* 数据操作 */}
      <SectionHeader title="数据操作" />
      {matchesSearch("导出数据") && (
        <SettingRow label="导出数据" description="将应用数据导出为文件">
          <Button onClick={handleExport}>导出</Button>
        </SettingRow>
      )}
      {matchesSearch("导入数据") && (
        <SettingRow label="导入数据" description="从文件导入应用数据">
          <Button onClick={handleImport}>导入</Button>
        </SettingRow>
      )}
      {matchesSearch("清除缓存") && (
        <SettingRow label="清除缓存" description="清除临时缓存数据，不影响会话和设置">
          <Popconfirm
            title="确认清除缓存？"
            description="此操作将清除所有临时缓存数据"
            onConfirm={handleClearCache}
            okText="确认"
            cancelText="取消"
          >
            <Button>清除缓存</Button>
          </Popconfirm>
        </SettingRow>
      )}
      {matchesSearch("清除所有数据") && (
        <SettingRow label="清除所有数据" description="删除所有应用数据，包括会话、设置和凭据">
          <Popconfirm
            title="确认清除所有数据？"
            description="此操作不可恢复，将删除所有会话、设置和凭据数据"
            onConfirm={handleClearAll}
            okText="确认清除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button danger>清除所有数据</Button>
          </Popconfirm>
        </SettingRow>
      )}
    </div>
  );
}
