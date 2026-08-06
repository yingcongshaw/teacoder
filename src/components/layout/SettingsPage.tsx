import { useState } from "react";
import { Menu, Input } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import GeneralSettingsPage from "../settings/GeneralSettingsPage";
import TerminalSettingsPage from "../settings/TerminalSettingsPage";
import ClaudeSettingsPage from "../settings/ClaudeSettingsPage";
import CodexSettingsPage from "../settings/CodexSettingsPage";
import GeminiSettingsPage from "../settings/GeminiSettingsPage";
import AntigravitySettingsPage from "../settings/AntigravitySettingsPage";
import OpenCodeSettingsPage from "../settings/OpenCodeSettingsPage";
import AIAssistantPage from "../settings/AIAssistantPage";
import NetworkSettingsPage from "../settings/NetworkSettingsPage";
import RemoteAccessPage from "../settings/RemoteAccessPage";
import KeybindingsPage from "../settings/KeybindingsPage";
import NotificationPage from "../settings/NotificationPage";
import DataManagementPage from "../settings/DataManagementPage";
import SyncPage from "../settings/SyncPage";
import McpAccessPage from "../settings/McpAccessPage";
import AboutPage from "../settings/AboutPage";

const SIDEBAR_WIDTH = 180;

const menuItems = [
  { key: "general", label: "通用设置" },
  { key: "claude", label: "Claude Code" },
  { key: "codex", label: "Codex CLI" },
  { key: "gemini", label: "Gemini CLI" },
  { key: "antigravity", label: "Antigravity" },
  { key: "opencode", label: "OpenCode" },
  { key: "terminal", label: "终端设置" },
  { key: "ai-assistant", label: "AI 辅助" },
  { key: "network", label: "网络" },
  { key: "remote", label: "远程访问" },
  { key: "keybindings", label: "快捷键" },
  { key: "notification", label: "通知" },
  { key: "data-management", label: "数据管理" },
  { key: "sync", label: "同步" },
  { key: "mcp", label: "MCP 接入" },
  { key: "about", label: "关于" },
];

const PAGE_TITLES: Record<string, string> = {
  general: "通用设置",
  terminal: "终端设置",
  claude: "Claude Code",
  codex: "Codex CLI",
  gemini: "Gemini CLI",
  antigravity: "Antigravity",
  opencode: "OpenCode",
  "ai-assistant": "AI 辅助",
  network: "网络",
  remote: "远程访问",
  keybindings: "快捷键",
  notification: "通知",
  "data-management": "数据管理",
  sync: "同步",
  mcp: "MCP 接入",
  about: "关于",
};

export default function SettingsPage() {
  const [activeKey, setActiveKey] = useState("general");
  const [searchText, setSearchText] = useState("");

  const renderContent = () => {
    const props = { searchText };
    switch (activeKey) {
      case "general":
        return <GeneralSettingsPage {...props} />;
      case "terminal":
        return <TerminalSettingsPage {...props} />;
      case "claude":
        return <ClaudeSettingsPage {...props} />;
      case "codex":
        return <CodexSettingsPage {...props} />;
      case "gemini":
        return <GeminiSettingsPage {...props} />;
      case "antigravity":
        return <AntigravitySettingsPage {...props} />;
      case "opencode":
        return <OpenCodeSettingsPage {...props} />;
      case "ai-assistant":
        return <AIAssistantPage {...props} />;
      case "network":
        return <NetworkSettingsPage {...props} />;
      case "remote":
        return <RemoteAccessPage {...props} />;
      case "keybindings":
        return <KeybindingsPage {...props} />;
      case "notification":
        return <NotificationPage {...props} />;
      case "data-management":
        return <DataManagementPage {...props} />;
      case "sync":
        return <SyncPage {...props} />;
      case "mcp":
        return <McpAccessPage {...props} />;
      case "about":
        return <AboutPage {...props} />;
      default:
        return null;
    }
  };

  return (
    <div className="h-full flex" style={{ background: "var(--ant-color-bg-layout)" }}>
      {/* Left sidebar */}
      <div
        style={{
          width: SIDEBAR_WIDTH,
          borderRight: "1px solid var(--ant-color-border-secondary)",
          background: "var(--ant-color-bg-container)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ flex: 1, overflowY: "auto" }}>
          <Menu
            mode="inline"
            selectedKeys={[activeKey]}
            onClick={({ key }) => setActiveKey(key)}
            items={menuItems.map((item) => ({
              key: item.key,
              label: item.label,
            }))}
            style={{
              borderRight: 0,
              fontSize: 13,
            }}
          />
        </div>
      </div>

      {/* Right content area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Top bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 24px",
            borderBottom: "1px solid var(--ant-color-border-secondary)",
            background: "var(--ant-color-bg-container)",
          }}
        >
          <span style={{ fontSize: 16, fontWeight: 600, color: "var(--ant-color-text)" }}>
            {PAGE_TITLES[activeKey] || ""}
          </span>
          <Input
            prefix={<SearchOutlined style={{ color: "var(--ant-color-text-quaternary)" }} />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="搜索设置..."
            allowClear
            style={{ width: 200, borderRadius: 6, fontSize: 12 }}
          />
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 24px 24px" }}>
            {renderContent()}
          </div>
        </div>
      </div>
    </div>
  );
}
