import { useState, useEffect } from "react";
import { Select, Switch, Input, InputNumber, App } from "antd";
import SettingRow from "./components/SettingRow";
import SectionHeader from "./components/SectionHeader";

interface NetworkSettings {
  enableProxy: boolean;
  proxyType: string;
  proxyAddress: string;
  proxyAuth: boolean;
  proxyUsername: string;
  proxyPassword: string;
  connectionTimeout: number;
  retryCount: number;
  sslVerify: boolean;
}

const DEFAULT_SETTINGS: NetworkSettings = {
  enableProxy: false,
  proxyType: "http",
  proxyAddress: "",
  proxyAuth: false,
  proxyUsername: "",
  proxyPassword: "",
  connectionTimeout: 30,
  retryCount: 3,
  sslVerify: true,
};

interface NetworkSettingsPageProps {
  searchText?: string;
}

export default function NetworkSettingsPage({ searchText = "" }: NetworkSettingsPageProps) {
  const { message } = App.useApp();
  const [settings, setSettings] = useState<NetworkSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("teacoder_network_settings");
      const saved = raw ? JSON.parse(raw) : {};
      setSettings({ ...DEFAULT_SETTINGS, ...saved });
    } catch {
      setSettings(DEFAULT_SETTINGS);
    }
  }, []);

  const updateSetting = <K extends keyof NetworkSettings>(
    key: K,
    value: NetworkSettings[K]
  ) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    localStorage.setItem("teacoder_network_settings", JSON.stringify(next));
    message.success("设置已保存");
  };

  const matchesSearch = (label: string, desc?: string) => {
    if (!searchText) return true;
    const q = searchText.toLowerCase();
    return label.toLowerCase().includes(q) || (desc && desc.toLowerCase().includes(q));
  };

  return (
    <div>
      {/* 代理 */}
      <SectionHeader title="代理" />
      {matchesSearch("启用代理") && (
        <SettingRow label="启用代理" description="通过代理服务器连接网络">
          <Switch
            checked={settings.enableProxy}
            onChange={(v) => updateSetting("enableProxy", v)}
          />
        </SettingRow>
      )}
      {matchesSearch("代理类型") && settings.enableProxy && (
        <SettingRow label="代理类型" description="选择代理协议类型" indent>
          <Select
            value={settings.proxyType}
            onChange={(v) => updateSetting("proxyType", v)}
            style={{ width: 160 }}
          >
            <Select.Option value="http">HTTP</Select.Option>
            <Select.Option value="socks5">SOCKS5</Select.Option>
            <Select.Option value="system">系统代理</Select.Option>
          </Select>
        </SettingRow>
      )}
      {matchesSearch("代理地址") && settings.enableProxy && (
        <SettingRow label="代理地址" description="代理服务器地址，格式：host:port" indent>
          <Input
            value={settings.proxyAddress}
            onChange={(e) => updateSetting("proxyAddress", e.target.value)}
            placeholder="127.0.0.1:7890"
            style={{ width: 200 }}
          />
        </SettingRow>
      )}
      {matchesSearch("代理认证") && settings.enableProxy && (
        <SettingRow label="代理认证" description="代理服务器需要用户名和密码" indent>
          <Switch
            checked={settings.proxyAuth}
            onChange={(v) => updateSetting("proxyAuth", v)}
          />
        </SettingRow>
      )}
      {matchesSearch("用户名", "代理认证") && settings.enableProxy && settings.proxyAuth && (
        <SettingRow label="用户名" description="代理认证用户名" indent>
          <Input
            value={settings.proxyUsername}
            onChange={(e) => updateSetting("proxyUsername", e.target.value)}
            placeholder="username"
            style={{ width: 200 }}
          />
        </SettingRow>
      )}
      {matchesSearch("密码", "代理认证") && settings.enableProxy && settings.proxyAuth && (
        <SettingRow label="密码" description="代理认证密码" indent>
          <Input.Password
            value={settings.proxyPassword}
            onChange={(e) => updateSetting("proxyPassword", e.target.value)}
            placeholder="password"
            style={{ width: 200 }}
          />
        </SettingRow>
      )}

      {/* 连接 */}
      <SectionHeader title="连接" />
      {matchesSearch("连接超时") && (
        <SettingRow label="连接超时" description="网络请求超时时间">
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <InputNumber
              min={5}
              max={120}
              value={settings.connectionTimeout}
              onChange={(v) => updateSetting("connectionTimeout", v ?? 30)}
              style={{ width: 80 }}
            />
            <span style={{ fontSize: 12, color: "var(--ant-color-text-secondary)" }}>秒</span>
          </div>
        </SettingRow>
      )}
      {matchesSearch("重试次数") && (
        <SettingRow label="重试次数" description="请求失败后的重试次数">
          <InputNumber
            min={0}
            max={10}
            value={settings.retryCount}
            onChange={(v) => updateSetting("retryCount", v ?? 3)}
            style={{ width: 80 }}
          />
        </SettingRow>
      )}
      {matchesSearch("SSL 验证") && (
        <SettingRow label="SSL 验证" description="验证 SSL 证书有效性">
          <Switch
            checked={settings.sslVerify}
            onChange={(v) => updateSetting("sslVerify", v)}
          />
        </SettingRow>
      )}
    </div>
  );
}
