import { Typography, Tag, Space, Divider } from "antd";
import {
  GithubOutlined,
  HeartOutlined,
} from "@ant-design/icons";
import SettingRow from "./components/SettingRow";
import SectionHeader from "./components/SectionHeader";

interface AboutPageProps {
  searchText?: string;
}

export default function AboutPage({ searchText = "" }: AboutPageProps) {
  const matchesSearch = (label: string, desc?: string) => {
    if (!searchText) return true;
    const q = searchText.toLowerCase();
    return label.toLowerCase().includes(q) || (desc && desc.toLowerCase().includes(q));
  };

  return (
    <div>
      {/* App identity */}
      <div style={{ textAlign: "center", padding: "32px 0 24px" }}>
        <div
          style={{
            width: 72,
            height: 72,
            margin: "0 auto 16px",
            borderRadius: 16,
            background: "linear-gradient(135deg, #1677ff 0%, #722ed1 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontSize: 28,
            fontWeight: 700,
          }}
        >
          茶
        </div>
        <Typography.Title level={4} style={{ margin: 0 }}>
          茶码 CodingTea
        </Typography.Title>
        <div style={{ marginTop: 4, color: "var(--ant-color-text-secondary)", fontSize: 13 }}>
          AI 编程 CLI 工具桌面管理客户端
        </div>
        <div style={{ marginTop: 8 }}>
          <Tag color="blue">v0.1.0</Tag>
          <Tag color="green">MVP</Tag>
        </div>
      </div>

      <Divider style={{ margin: "8px 0" }} />

      {/* 应用信息 */}
      <SectionHeader title="应用信息" />
      {matchesSearch("应用名称") && (
        <SettingRow label="应用名称">茶码 CodingTea</SettingRow>
      )}
      {matchesSearch("版本") && (
        <SettingRow label="版本">v0.1.0</SettingRow>
      )}
      {matchesSearch("更新通道") && (
        <SettingRow label="更新通道" description="选择接收更新的通道">
          <Tag>稳定</Tag>
        </SettingRow>
      )}

      {/* 系统 */}
      <SectionHeader title="系统" />
      {matchesSearch("操作系统") && (
        <SettingRow label="操作系统">
          <span style={{ color: "var(--ant-color-text-secondary)", fontSize: 13 }}>
            {navigator.platform}
          </span>
        </SettingRow>
      )}
      {matchesSearch("架构") && (
        <SettingRow label="架构">
          <span style={{ color: "var(--ant-color-text-secondary)", fontSize: 13 }}>
            {navigator.userAgent.includes("x86_64") || navigator.userAgent.includes("x64") ? "x64" : "arm64"}
          </span>
        </SettingRow>
      )}
      {matchesSearch("Tauri 版本") && (
        <SettingRow label="Tauri 版本">
          <span style={{ color: "var(--ant-color-text-secondary)", fontSize: 13 }}>2.x</span>
        </SettingRow>
      )}

      {/* 技术栈 */}
      <SectionHeader title="技术栈" />
      <div style={{ padding: "12px 0" }}>
        <Space wrap size={[4, 4]}>
          {["Tauri 2.x", "Rust", "React 19", "TypeScript", "Ant Design 6", "TailwindCSS 4", "xterm.js", "SQLite"].map(
            (tech) => (
              <Tag key={tech}>{tech}</Tag>
            )
          )}
        </Space>
      </div>

      {/* 链接 */}
      <SectionHeader title="链接" />
      <div style={{ padding: "12px 0" }}>
        <Space>
          <a
            href="https://github.com/codingtea/codingtea"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--ant-color-primary)" }}
          >
            <GithubOutlined />
            GitHub
          </a>
        </Space>
      </div>

      <Divider style={{ margin: "8px 0" }} />

      <div style={{ textAlign: "center", color: "var(--ant-color-text-tertiary)", fontSize: 12, padding: "8px 0" }}>
        <p style={{ margin: 0 }}>
          <HeartOutlined style={{ marginRight: 4 }} />
          Made with love by the CodingTea Team
        </p>
        <p style={{ margin: 0 }}>MIT License</p>
      </div>
    </div>
  );
}
