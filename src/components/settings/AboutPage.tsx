import { useEffect } from "react";
import { Typography, Tag, Space, Divider, Switch, Tooltip } from "antd";
import {
  GithubOutlined,
  HeartOutlined,
} from "@ant-design/icons";
import SettingRow from "./components/SettingRow";
import SectionHeader from "./components/SectionHeader";
import { useUpdateStore } from "../../stores/updateStore";
import { useAppVersion } from "../../hooks/useAppVersion";
import { compareVersions } from "../../utils/updateCheck";
import { openExternal } from "../../utils/openExternal";

const RELEASES_URL = "https://github.com/yingcongshaw/teacoder/releases";

interface AboutPageProps {
  searchText?: string;
}

export default function AboutPage({ searchText = "" }: AboutPageProps) {
  const appVersion = useAppVersion();
  const latestRelease = useUpdateStore((s) => s.latestRelease);
  const checked = useUpdateStore((s) => s.checked);
  const notifyEnabled = useUpdateStore((s) => s.notifyEnabled);
  const setNotifyEnabled = useUpdateStore((s) => s.setNotifyEnabled);
  const checkLatest = useUpdateStore((s) => s.checkLatest);

  // 没缓存过就现查一次
  useEffect(() => {
    if (!checked) checkLatest().catch(() => {});
  }, [checked, checkLatest]);

  const matchesSearch = (label: string, desc?: string) => {
    if (!searchText) return true;
    const q = searchText.toLowerCase();
    return label.toLowerCase().includes(q) || (desc && desc.toLowerCase().includes(q));
  };

  const isUpToDate =
    latestRelease && appVersion
      ? compareVersions(latestRelease.tagName, appVersion) <= 0
      : false;

  const latestText = !checked
    ? "检查中…"
    : latestRelease
      ? latestRelease.tagName
      : "获取失败";

  return (
    <div>
      {/* App identity */}
      <div style={{ textAlign: "center", padding: "32px 0 24px" }}>
        <img
          src="/logo.png"
          alt="TeaCoder"
          width={72}
          height={72}
          style={{ display: "block", margin: "0 auto 16px", borderRadius: 16 }}
        />
        <Typography.Title level={4} style={{ margin: 0 }}>
          TeaCoder
        </Typography.Title>
        <div style={{ marginTop: 4, color: "var(--ant-color-text-secondary)", fontSize: 13 }}>
          AI 编程 CLI 工具桌面管理客户端
        </div>
        <div style={{ marginTop: 8 }}>
          <Tag color="blue">v{appVersion || "…"}</Tag>
          <Tag color="green">MVP</Tag>
        </div>
      </div>

      <Divider style={{ margin: "8px 0" }} />

      {/* 应用信息 */}
      <SectionHeader title="应用信息" />
      {matchesSearch("应用名称") && (
        <SettingRow label="应用名称">TeaCoder</SettingRow>
      )}
      {matchesSearch("版本") && (
        <SettingRow label="版本">v{appVersion || "…"}</SettingRow>
      )}
      {matchesSearch("最新版本") && (
        <SettingRow label="最新版本" description="检测到新版本时在启动时弹窗提示">
          <Space size={10} align="center">
            <span style={{ fontSize: 13 }}>{latestText}</span>
            {isUpToDate && (
              <Tag color="green" style={{ marginInlineEnd: 0 }}>
                已是最新
              </Tag>
            )}
            <Tooltip title="更新通知：每次启动时检查新版本，有新版本就弹窗提示">
              <Switch
                size="small"
                checked={notifyEnabled}
                onChange={(v) => setNotifyEnabled(v)}
              />
            </Tooltip>
          </Space>
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
            href="https://github.com/yingcongshaw/teacoder"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--ant-color-primary)", cursor: "pointer" }}
            onClick={(e) => {
              e.preventDefault();
              void openExternal("https://github.com/yingcongshaw/teacoder");
            }}
          >
            <GithubOutlined />
            GitHub
          </a>
          <a
            href={RELEASES_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--ant-color-primary)", cursor: "pointer" }}
            onClick={(e) => {
              e.preventDefault();
              void openExternal(RELEASES_URL);
            }}
          >
            更新日志
          </a>
        </Space>
      </div>

      <Divider style={{ margin: "8px 0" }} />

      <div style={{ textAlign: "center", color: "var(--ant-color-text-tertiary)", fontSize: 12, padding: "8px 0" }}>
        <p style={{ margin: 0 }}>
          <HeartOutlined style={{ marginRight: 4 }} />
          Made with love by the CodingTea
        </p>
        <p style={{ margin: 0 }}>MIT License</p>
      </div>
    </div>
  );
}
