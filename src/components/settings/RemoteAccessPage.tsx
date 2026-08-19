import { useState, useEffect } from "react";
import { Switch, Input, InputNumber, Button, message } from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import SettingRow from "./components/SettingRow";
import SectionHeader from "./components/SectionHeader";

interface SshHost {
  name: string;
  host: string;
  port: number;
  user: string;
  authType: "key" | "password";
  keyPath?: string;
}

interface RemoteAccessSettings {
  sshHosts: SshHost[];
  enableTunnel: boolean;
  tunnelPort: number;
}

const DEFAULT_SETTINGS: RemoteAccessSettings = {
  sshHosts: [],
  enableTunnel: false,
  tunnelPort: 49999,
};

const DEFAULT_HOST_FORM: Omit<SshHost, "keyPath"> & { keyPath: string } = {
  name: "",
  host: "",
  port: 22,
  user: "",
  authType: "key",
  keyPath: "",
};

interface RemoteAccessPageProps {
  searchText?: string;
}

export default function RemoteAccessPage({ searchText = "" }: RemoteAccessPageProps) {
  const [settings, setSettings] = useState<RemoteAccessSettings>(DEFAULT_SETTINGS);
  const [showAddForm, setShowAddForm] = useState(false);
  const [hostForm, setHostForm] = useState(DEFAULT_HOST_FORM);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("teacoder_remoteaccess_settings");
      const saved = raw ? JSON.parse(raw) : {};
      setSettings({ ...DEFAULT_SETTINGS, ...saved });
    } catch {
      setSettings(DEFAULT_SETTINGS);
    }
  }, []);

  const saveSettings = (next: RemoteAccessSettings) => {
    setSettings(next);
    localStorage.setItem("teacoder_remoteaccess_settings", JSON.stringify(next));
    message.success("设置已保存");
  };

  const updateSetting = <K extends keyof RemoteAccessSettings>(
    key: K,
    value: RemoteAccessSettings[K]
  ) => {
    saveSettings({ ...settings, [key]: value });
  };

  const matchesSearch = (label: string, desc?: string) => {
    if (!searchText) return true;
    const q = searchText.toLowerCase();
    return label.toLowerCase().includes(q) || (desc && desc.toLowerCase().includes(q));
  };

  const handleAddHost = () => {
    if (!hostForm.name.trim() || !hostForm.host.trim() || !hostForm.user.trim()) {
      message.warning("请填写主机名、地址和用户名");
      return;
    }
    const newHost: SshHost = {
      name: hostForm.name.trim(),
      host: hostForm.host.trim(),
      port: hostForm.port,
      user: hostForm.user.trim(),
      authType: hostForm.authType,
      ...(hostForm.authType === "key" && hostForm.keyPath ? { keyPath: hostForm.keyPath } : {}),
    };
    saveSettings({ ...settings, sshHosts: [...settings.sshHosts, newHost] });
    setHostForm(DEFAULT_HOST_FORM);
    setShowAddForm(false);
  };

  const handleRemoveHost = (index: number) => {
    const next = [...settings.sshHosts];
    next.splice(index, 1);
    saveSettings({ ...settings, sshHosts: next });
  };

  return (
    <div>
      {/* SSH */}
      <SectionHeader title="SSH" />
      {matchesSearch("SSH 主机列表") && (
        <div style={{ borderBottom: "1px solid var(--ant-color-border-secondary)", padding: "12px 0" }}>
          {settings.sshHosts.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)", padding: "8px 0" }}>
              暂无 SSH 主机
            </div>
          )}
          {settings.sshHosts.map((h, i) => (
            <div
              key={i}
              className="flex items-center justify-between"
              style={{
                padding: "8px 12px",
                marginBottom: 4,
                borderRadius: 6,
                background: "var(--ant-color-fill-quaternary)",
              }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ant-color-text)" }}>
                  {h.name}
                </div>
                <div style={{ fontSize: 12, color: "var(--ant-color-text-secondary)" }}>
                  {h.user}@{h.host}:{h.port} · {h.authType === "key" ? "密钥认证" : "密码认证"}
                </div>
              </div>
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() => handleRemoveHost(i)}
              />
            </div>
          ))}
          {showAddForm ? (
            <div
              style={{
                padding: 12,
                marginTop: 8,
                borderRadius: 6,
                border: "1px dashed var(--ant-color-border)",
                background: "var(--ant-color-fill-quaternary)",
              }}
            >
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={hostForm.name}
                    onChange={(e) => setHostForm({ ...hostForm, name: e.target.value })}
                    placeholder="主机名称"
                    style={{ width: 140 }}
                  />
                  <Input
                    value={hostForm.host}
                    onChange={(e) => setHostForm({ ...hostForm, host: e.target.value })}
                    placeholder="主机地址"
                    style={{ flex: 1 }}
                  />
                  <InputNumber
                    min={1}
                    max={65535}
                    value={hostForm.port}
                    onChange={(v) => setHostForm({ ...hostForm, port: v ?? 22 })}
                    style={{ width: 80 }}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    value={hostForm.user}
                    onChange={(e) => setHostForm({ ...hostForm, user: e.target.value })}
                    placeholder="用户名"
                    style={{ width: 140 }}
                  />
                  <select
                    value={hostForm.authType}
                    onChange={(e) => setHostForm({ ...hostForm, authType: e.target.value as "key" | "password" })}
                    style={{
                      height: 32,
                      borderRadius: 6,
                      border: "1px solid var(--ant-color-border)",
                      padding: "0 8px",
                      fontSize: 14,
                      background: "var(--ant-color-bg-container)",
                      color: "var(--ant-color-text)",
                    }}
                  >
                    <option value="key">密钥认证</option>
                    <option value="password">密码认证</option>
                  </select>
                  {hostForm.authType === "key" && (
                    <Input
                      value={hostForm.keyPath}
                      onChange={(e) => setHostForm({ ...hostForm, keyPath: e.target.value })}
                      placeholder="密钥路径 (~/.ssh/id_rsa)"
                      style={{ flex: 1 }}
                    />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button type="primary" size="small" onClick={handleAddHost}>
                    确认添加
                  </Button>
                  <Button size="small" onClick={() => { setShowAddForm(false); setHostForm(DEFAULT_HOST_FORM); }}>
                    取消
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <Button
              type="dashed"
              size="small"
              onClick={() => setShowAddForm(true)}
              style={{ marginTop: 8 }}
            >
              + 添加 SSH 主机
            </Button>
          )}
        </div>
      )}

      {/* 隧道 */}
      <SectionHeader title="隧道" />
      {matchesSearch("运行自签隧道") && (
        <SettingRow label="运行自签隧道" description="启用本地自签名隧道连接">
          <Switch
            checked={settings.enableTunnel}
            onChange={(v) => updateSetting("enableTunnel", v)}
          />
        </SettingRow>
      )}
      {matchesSearch("隧道端口") && (
        <SettingRow label="隧道端口" description="本地隧道监听端口">
          <InputNumber
            min={1024}
            max={65535}
            value={settings.tunnelPort}
            onChange={(v) => updateSetting("tunnelPort", v ?? 49999)}
            style={{ width: 100 }}
          />
        </SettingRow>
      )}
    </div>
  );
}
