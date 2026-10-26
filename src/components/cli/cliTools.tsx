import { CodeOutlined, DesktopOutlined, CloudOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";
import type { CliTool, ToolType } from "../../types";

export interface CliToolMeta {
  id: ToolType;
  name: string;
  icon?: string;
  iconComponent?: ReactNode;
  color: string;
  desc: string;
  alwaysAvailable?: boolean;
  inSettingsGroup?: boolean;
}

export const CLI_TOOLS: CliToolMeta[] = [
  { id: "claude", name: "Claude Code", icon: "/claude.png", color: "#722ed1", desc: "Anthropic 官方 CLI", inSettingsGroup: true },
  { id: "codex", name: "Codex CLI", icon: "/codex.png", color: "#1890ff", desc: "OpenAI Codex CLI", inSettingsGroup: true },
  { id: "gemini", name: "Gemini CLI", icon: "/gemini.png", color: "#1677ff", desc: "Google Gemini CLI", inSettingsGroup: true },
  { id: "antigravity", name: "Antigravity", color: "#52c41a", desc: "Antigravity CLI", alwaysAvailable: true, inSettingsGroup: true },
  { id: "opencode", name: "OpenCode", icon: "/opencode.png", color: "#fa8c16", desc: "开源编码助手", inSettingsGroup: true },
  { id: "terminal", name: "终端", iconComponent: <DesktopOutlined />, color: "#52c41a", desc: "本机系统 Shell", alwaysAvailable: true, inSettingsGroup: true },
  { id: "ssh", name: "SSH", iconComponent: <CloudOutlined />, color: "#1677ff", desc: "SSH 远程连接", alwaysAvailable: true, inSettingsGroup: true },
];

export const CLI_TOOLS_IN_SETTINGS_GROUP: CliToolMeta[] =
  CLI_TOOLS.filter((t) => t.inSettingsGroup === true);

export function getCliToolMeta(id: ToolType): CliToolMeta | undefined {
  return CLI_TOOLS.find((t) => t.id === id);
}

export function getCliToolIcon(id: ToolType): ReactNode {
  const meta = getCliToolMeta(id);
  if (!meta) return <CodeOutlined />;
  if (meta.icon) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 18,
          height: 18,
          borderRadius: 4,
          background: `${meta.color}20`,
        }}
      >
        <img src={meta.icon} alt="" style={{ width: 14, height: 14 }} />
      </span>
    );
  }
  return meta.iconComponent ?? <CodeOutlined style={{ color: meta.color }} />;
}

export function sortCliToolsByAvailability(
  tools: CliToolMeta[],
  cliTools: CliTool[],
): CliToolMeta[] {
  const detectedAvailable = new Set(
    cliTools.filter((t) => t.isAvailable).map((t) => t.toolType),
  );
  const available = (meta: CliToolMeta) =>
    meta.alwaysAvailable === true || detectedAvailable.has(meta.id);
  return [...tools].sort((a, b) => {
    const aAvail = available(a);
    const bAvail = available(b);
    if (aAvail && !bAvail) return -1;
    if (!aAvail && bAvail) return 1;
    return 0;
  });
}

export function isCliToolAvailable(
  meta: CliToolMeta,
  cliTools: CliTool[],
): boolean {
  if (meta.alwaysAvailable === true) return true;
  const detected = cliTools.find((t) => t.toolType === meta.id);
  return detected?.isAvailable === true;
}