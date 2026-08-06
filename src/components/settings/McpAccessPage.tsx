import { useState, useEffect } from "react";
import { Switch, Input, Button, message } from "antd";
import { DeleteOutlined, EditOutlined } from "@ant-design/icons";
import SectionHeader from "./components/SectionHeader";

interface McpServer {
  name: string;
  command: string;
  args: string;
  enabled: boolean;
}

interface McpAccessSettings {
  servers: McpServer[];
}

const DEFAULT_SETTINGS: McpAccessSettings = {
  servers: [],
};

const DEFAULT_SERVER_FORM: McpServer = {
  name: "",
  command: "",
  args: "",
  enabled: true,
};

interface McpAccessPageProps {
  searchText?: string;
}

export default function McpAccessPage({ searchText = "" }: McpAccessPageProps) {
  const [settings, setSettings] = useState<McpAccessSettings>(DEFAULT_SETTINGS);
  const [showAddForm, setShowAddForm] = useState(false);
  const [serverForm, setServerForm] = useState<McpServer>(DEFAULT_SERVER_FORM);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("codingtea_mcpaccess_settings");
      const saved = raw ? JSON.parse(raw) : {};
      setSettings({ ...DEFAULT_SETTINGS, ...saved });
    } catch {
      setSettings(DEFAULT_SETTINGS);
    }
  }, []);

  const saveSettings = (next: McpAccessSettings) => {
    setSettings(next);
    localStorage.setItem("codingtea_mcpaccess_settings", JSON.stringify(next));
    message.success("设置已保存");
  };

  const matchesSearch = (label: string, desc?: string) => {
    if (!searchText) return true;
    const q = searchText.toLowerCase();
    return label.toLowerCase().includes(q) || (desc && desc.toLowerCase().includes(q));
  };

  const handleAddServer = () => {
    if (!serverForm.name.trim() || !serverForm.command.trim()) {
      message.warning("请填写服务器名称和命令");
      return;
    }
    const newServer: McpServer = {
      name: serverForm.name.trim(),
      command: serverForm.command.trim(),
      args: serverForm.args.trim(),
      enabled: serverForm.enabled,
    };
    if (editingIndex !== null) {
      const next = [...settings.servers];
      next[editingIndex] = newServer;
      saveSettings({ ...settings, servers: next });
      setEditingIndex(null);
    } else {
      saveSettings({ ...settings, servers: [...settings.servers, newServer] });
    }
    setServerForm(DEFAULT_SERVER_FORM);
    setShowAddForm(false);
  };

  const handleRemoveServer = (index: number) => {
    const next = [...settings.servers];
    next.splice(index, 1);
    saveSettings({ ...settings, servers: next });
  };

  const handleToggleServer = (index: number, enabled: boolean) => {
    const next = [...settings.servers];
    next[index] = { ...next[index], enabled };
    saveSettings({ ...settings, servers: next });
  };

  const handleEditServer = (index: number) => {
    const server = settings.servers[index];
    setServerForm({ ...server });
    setEditingIndex(index);
    setShowAddForm(true);
  };

  const handleCancelForm = () => {
    setShowAddForm(false);
    setServerForm(DEFAULT_SERVER_FORM);
    setEditingIndex(null);
  };

  return (
    <div>
      {/* MCP 服务器 */}
      <SectionHeader title="MCP 服务器" />
      {matchesSearch("MCP 服务器列表") && (
        <div style={{ borderBottom: "1px solid var(--ant-color-border-secondary)", padding: "12px 0" }}>
          {settings.servers.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)", padding: "8px 0" }}>
              暂无 MCP 服务器
            </div>
          )}
          {settings.servers.map((s, i) => (
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
              <div className="flex items-center gap-2">
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: s.enabled ? "var(--ant-color-success)" : "var(--ant-color-error)",
                    flexShrink: 0,
                  }}
                />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ant-color-text)" }}>
                    {s.name}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ant-color-text-secondary)" }}>
                    {s.command} {s.args}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  size="small"
                  checked={s.enabled}
                  onChange={(v) => handleToggleServer(i, v)}
                />
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => handleEditServer(i)}
                />
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => handleRemoveServer(i)}
                />
              </div>
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
                    value={serverForm.name}
                    onChange={(e) => setServerForm({ ...serverForm, name: e.target.value })}
                    placeholder="服务器名称"
                    style={{ width: 160 }}
                  />
                  <Input
                    value={serverForm.command}
                    onChange={(e) => setServerForm({ ...serverForm, command: e.target.value })}
                    placeholder="命令 (例如: npx)"
                    style={{ flex: 1 }}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    value={serverForm.args}
                    onChange={(e) => setServerForm({ ...serverForm, args: e.target.value })}
                    placeholder="参数 (例如: -y @modelcontextprotocol/server-memory)"
                    style={{ flex: 1 }}
                  />
                  <div className="flex items-center gap-1" style={{ flexShrink: 0 }}>
                    <span style={{ fontSize: 12, color: "var(--ant-color-text-secondary)" }}>启用</span>
                    <Switch
                      size="small"
                      checked={serverForm.enabled}
                      onChange={(v) => setServerForm({ ...serverForm, enabled: v })}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button type="primary" size="small" onClick={handleAddServer}>
                    {editingIndex !== null ? "确认修改" : "确认添加"}
                  </Button>
                  <Button size="small" onClick={handleCancelForm}>
                    取消
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <Button
              type="dashed"
              size="small"
              onClick={() => { setShowAddForm(true); setEditingIndex(null); setServerForm(DEFAULT_SERVER_FORM); }}
              style={{ marginTop: 8 }}
            >
              + 添加服务器
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
