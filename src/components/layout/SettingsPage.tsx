import { useEffect, useState } from "react";
import { Menu, Input } from "antd";
import {
  SearchOutlined,
  SettingOutlined,
  CodeOutlined,
  RobotOutlined,
  GlobalOutlined,
  CloudServerOutlined,
  KeyOutlined,
  BellOutlined,
  DatabaseOutlined,
  SyncOutlined,
  ApiOutlined,
  InfoCircleOutlined,
  CloudOutlined,
} from "@ant-design/icons";
import { CLI_TOOLS, CLI_TOOLS_IN_SETTINGS_GROUP, getCliToolIcon } from "../cli/cliTools";
import { useAppStore } from "../../stores/appStore";
import GeneralSettingsPage from "../settings/GeneralSettingsPage";
import TerminalSettingsPage from "../settings/TerminalSettingsPage";
import ClaudeSettingsPage from "../settings/ClaudeSettingsPage";
import CodexSettingsPage from "../settings/CodexSettingsPage";
import GeminiSettingsPage from "../settings/GeminiSettingsPage";
import AntigravitySettingsPage from "../settings/AntigravitySettingsPage";
import OpenCodeSettingsPage from "../settings/OpenCodeSettingsPage";
import ProfileManagementPage from "../settings/ProfileManagementPage";
import AIAssistantPage from "../settings/AIAssistantPage";
import NetworkSettingsPage from "../settings/NetworkSettingsPage";
import RemoteAccessPage from "../settings/RemoteAccessPage";
import KeybindingsPage from "../settings/KeybindingsPage";
import NotificationPage from "../settings/NotificationPage";
import DataManagementPage from "../settings/DataManagementPage";
import SyncPage from "../settings/SyncPage";
import McpAccessPage from "../settings/McpAccessPage";
import AboutPage from "../settings/AboutPage";
import LlmProvidersPage from "../settings/LlmProvidersPage";

const SIDEBAR_WIDTH = 180;

function CliToolIcon({ toolKey }: { toolKey: string }) {
  return getCliToolIcon(toolKey as Parameters<typeof getCliToolIcon>[0]);
}

const menuItems = [
  { key: "general", label: "通用设置", icon: <SettingOutlined /> },
  { key: "terminal", label: "终端设置", icon: <CodeOutlined /> },
  { key: "llm-providers", label: "LLM 设置", icon: <CloudOutlined /> },
  {
    key: "cli-tools-group",
    label: "CLI 工具",
    icon: <RobotOutlined />,
    children: CLI_TOOLS_IN_SETTINGS_GROUP.map((t) => ({
      key: t.id,
      label: t.name,
      icon: <CliToolIcon toolKey={t.id} />,
    })),
  },
  { key: "ai-assistant", label: "AI 辅助", icon: <RobotOutlined /> },
  { key: "network", label: "网络", icon: <GlobalOutlined /> },
  { key: "remote", label: "远程访问", icon: <CloudServerOutlined /> },
  { key: "keybindings", label: "快捷键", icon: <KeyOutlined /> },
  { key: "notification", label: "通知", icon: <BellOutlined /> },
  { key: "data-management", label: "数据管理", icon: <DatabaseOutlined /> },
  { key: "sync", label: "同步", icon: <SyncOutlined /> },
  { key: "mcp", label: "MCP 接入", icon: <ApiOutlined /> },
  { key: "about", label: "关于", icon: <InfoCircleOutlined /> },
];

const CLI_TOOL_TITLES: Record<string, string> = Object.fromEntries(
  CLI_TOOLS.map((t) => [t.id, t.name]),
);

const PAGE_TITLES: Record<string, string> = {
  general: "通用设置",
  terminal: "终端设置",
  "cli-tools-group": "CLI 工具",
  "profile-management": "Profile 管理",
  "ai-assistant": "AI 辅助",
  network: "网络",
  remote: "远程访问",
  keybindings: "快捷键",
  notification: "通知",
  "data-management": "数据管理",
  sync: "同步",
  mcp: "MCP 接入",
  about: "关于",
  "llm-providers": "LLM 设置",
  ...CLI_TOOL_TITLES,
};

export default function SettingsPage() {
  const activeKey = useAppStore((s) => s.settingsActiveKey);
  const setActiveKey = useAppStore((s) => s.setSettingsActiveKey);
  const [openKeys, setOpenKeys] = useState<string[]>(["cli-tools-group"]);
  const [searchText, setSearchText] = useState("");

  // 当设置面板打开时，自动展开 CLI 工具组
  useEffect(() => {
    setOpenKeys(["cli-tools-group"]);
  }, []);

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
      case "profile-management":
        return <ProfileManagementPage />;
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
      case "llm-providers":
        return <LlmProvidersPage />;
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
            openKeys={openKeys}
            onOpenChange={(keys) => setOpenKeys(keys)}
            onClick={({ key }) => {
              if (key !== "cli-tools-group") setActiveKey(key);
            }}
            items={menuItems.map((item) => {
              if ("children" in item && item.children) {
                return {
                  key: item.key,
                  icon: item.icon,
                  label: item.label,
                  children: item.children.map((child) => ({
                    key: child.key,
                    icon: child.icon,
                    label: child.label,
                  })),
                };
              }
              return {
                key: item.key,
                icon: item.icon,
                label: item.label,
              };
            })}
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
