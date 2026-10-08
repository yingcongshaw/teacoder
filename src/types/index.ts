export type ToolType = "claude" | "codex" | "gemini" | "antigravity" | "opencode" | "terminal" | "ssh";
export type AuthType = "api_key" | "oauth";

export interface CliTool {
  toolType: ToolType;
  version: string | null;
  path: string | null;
  isAvailable: boolean;
  lastDetectedAt: number;
}

export interface Profile {
  id: string;
  name: string;
  toolType: ToolType;
  authType: AuthType;
  baseUrl?: string;
  appDataRoot?: string;
  color?: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  apiKeyStored?: string;
  oauthTokenStored?: string;
  oauthRefreshTokenStored?: string;
}

export interface SessionCost {
  sessionId: string;
  profileId: string;
  toolType: ToolType;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  model: string;
  startedAt: number;
  endedAt: number | null;
}

export interface CostSummary {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  costUsd: number;
}

export interface PricingConfig {
  model: string;
  inputPrice: number;
  outputPrice: number;
  cacheCreationPrice: number;
  cacheReadPrice: number;
  isCustom: boolean;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  color?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SessionCategory {
  id: string;
  projectId: string;
  name: string;
  color?: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface Session {
  id: string;
  projectId: string;
  title?: string;
  toolType: ToolType;
  profileId?: string;
  color?: string;
  thinkingIntensity: string;
  templateId?: string;
  cliArgs?: string;
  envVars?: string;
  isRunning: boolean;
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
  cliSessionId?: string;
  categoryId?: string;
  llmProviderId?: string;
  modelName?: string;
  claudeModels?: { sonnet?: string; opus?: string; haiku?: string };
}

export interface SessionTemplate {
  id: string;
  name: string;
  icon?: string;
  defaultThinkingIntensity?: string;
  defaultCliArgs?: Record<string, unknown>;
  description?: string;
}

export const BUILTIN_SESSION_TEMPLATES: SessionTemplate[] = [
  { id: "none", name: "无模板", description: "空白会话" },
  { id: "workstation", name: "用工作站", description: "通用工作站模式", defaultThinkingIntensity: "high" },
  { id: "code-review", name: "代码审查", description: "代码审查专用", defaultThinkingIntensity: "medium" },
  { id: "bug-fix", name: "Bug修复", description: "Bug 定位与修复", defaultThinkingIntensity: "medium" },
  { id: "feature-dev", name: "功能开发", description: "新功能开发", defaultThinkingIntensity: "high" },
  { id: "refactor", name: "代码重构", description: "代码重构与优化", defaultThinkingIntensity: "medium" },
];

export interface TabState {
  id: string;
  title: string;
  toolType: ToolType;
  profileId: string;
  workDir: string;
  color?: string;
  isRunning: boolean;
  envVars?: string;
  args?: string;
  createdAt: number;
  closedAt?: number;
}

export interface ToolSettings {
  id: string;
  profileId: string;
  toolType: string;
  model?: string;
  thinkingIntensity?: string;
  autoSubmit?: boolean;
  customInstructions?: string;
  settingsJson?: string;
  createdAt: number;
  updatedAt: number;
}

export const TOOL_DISPLAY_NAMES: Record<ToolType, string> = {
  claude: "Claude Code",
  codex: "Codex CLI",
  gemini: "Gemini CLI",
  antigravity: "Antigravity",
  opencode: "OpenCode",
  terminal: "终端",
  ssh: "SSH",
};

export const TOOL_EXECUTABLES: Record<ToolType, string> = {
  claude: "claude",
  codex: "codex",
  gemini: "gemini",
  antigravity: "antigravity",
  opencode: "opencode",
  terminal: "terminal",
  ssh: "ssh",
};

export interface TerminalSettings {
  shell: string;
  shellArgs: string;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  cursorStyle: "block" | "bar" | "underline";
  cursorBlink: boolean;
  followAppTheme: boolean;
  colorTheme: string;
  scrollback: number;
  scrollOnOutput: boolean;
  bell: boolean;
  copyOnSelect: boolean;
  rightClickPaste: boolean;
  envVars: string;
}

export const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
  shell: "default",
  shellArgs: "",
  fontFamily: "Consolas",
  fontSize: 14,
  lineHeight: 1.2,
  cursorStyle: "block",
  cursorBlink: true,
  followAppTheme: false,
  colorTheme: "paper",
  scrollback: 10000,
  scrollOnOutput: true,
  bell: false,
  copyOnSelect: true,
  rightClickPaste: true,
  envVars: "",
};

export const DEFAULT_ANSI_COLORS = {
  black: "#000000",
  red: "#cc0000",
  green: "#00a400",
  yellow: "#a68a00",
  blue: "#0000cc",
  magenta: "#cc00cc",
  cyan: "#00a4cc",
  white: "#aaaaaa",
  brightBlack: "#555555",
  brightRed: "#e50000",
  brightGreen: "#00d600",
  brightYellow: "#d6d600",
  brightBlue: "#3333ff",
  brightMagenta: "#e500e5",
  brightCyan: "#00d6d6",
  brightWhite: "#ffffff",
} as const;

export interface TerminalColorTheme {
  name: string;
  label: string;
  colors: {
    background: string;
    foreground: string;
    cursor?: string;
    selectionBackground?: string;
    black?: string;
    red?: string;
    green?: string;
    yellow?: string;
    blue?: string;
    magenta?: string;
    cyan?: string;
    white?: string;
    brightBlack?: string;
    brightRed?: string;
    brightGreen?: string;
    brightYellow?: string;
    brightBlue?: string;
    brightMagenta?: string;
    brightCyan?: string;
    brightWhite?: string;
  };
}

export const TERMINAL_COLOR_THEMES: TerminalColorTheme[] = [
  {
    name: "one-dark",
    label: "One Dark",
    colors: {
      background: "#1e1e2e",
      foreground: "#cdd6f4",
      cursor: "#f5e0dc",
      selectionBackground: "#585b7066",
      black: "#45475a",
      red: "#f38ba8",
      green: "#a6e3a1",
      yellow: "#f9e2af",
      blue: "#89b4fa",
      magenta: "#f5c2e7",
      cyan: "#94e2d5",
      white: "#bac2de",
      brightBlack: "#585b70",
      brightRed: "#f38ba8",
      brightGreen: "#a6e3a1",
      brightYellow: "#f9e2af",
      brightBlue: "#89b4fa",
      brightMagenta: "#f5c2e7",
      brightCyan: "#94e2d5",
      brightWhite: "#a6adc8",
    },
  },
  {
    name: "windows-console",
    label: "Windows Console",
    colors: {
      background: "#0c0c0c",
      foreground: "#cccccc",
      cursor: "#cccccc",
      selectionBackground: "#444444",
      black: "#0c0c0c",
      red: "#c50f1f",
      green: "#13a10e",
      yellow: "#c19c00",
      blue: "#0037da",
      magenta: "#881798",
      cyan: "#3a96dd",
      white: "#cccccc",
      brightBlack: "#767676",
      brightRed: "#e74856",
      brightGreen: "#16c60c",
      brightYellow: "#f9f1a5",
      brightBlue: "#3b78ff",
      brightMagenta: "#b4009e",
      brightCyan: "#61d6d6",
      brightWhite: "#f6e7cb",
    },
  },
  {
    name: "dracula",
    label: "Dracula",
    colors: {
      background: "#282a36",
      foreground: "#f8f8f2",
      cursor: "#f8f8f2",
      selectionBackground: "#44475a",
      black: "#21222c",
      red: "#ff5555",
      green: "#50fa7b",
      yellow: "#f1fa8c",
      blue: "#bd93f9",
      magenta: "#ff79c6",
      cyan: "#8be9fd",
      white: "#f8f8f2",
      brightBlack: "#6272a4",
      brightRed: "#ff6e6e",
      brightGreen: "#69ff94",
      brightYellow: "#ffffa5",
      brightBlue: "#d6acff",
      brightMagenta: "#ff92df",
      brightCyan: "#a4ffff",
      brightWhite: "#ffffff",
    },
  },
  {
    name: "tokyo-night",
    label: "Tokyo Night",
    colors: {
      background: "#1a1b26",
      foreground: "#a9b1d6",
      cursor: "#c0caf5",
      selectionBackground: "#33467c",
      black: "#15161e",
      red: "#f7768e",
      green: "#9ece6a",
      yellow: "#e0af68",
      blue: "#7aa2f7",
      magenta: "#bb9af7",
      cyan: "#7dcfff",
      white: "#a9b1d6",
      brightBlack: "#414868",
      brightRed: "#f7768e",
      brightGreen: "#9ece6a",
      brightYellow: "#e0af68",
      brightBlue: "#7aa2f7",
      brightMagenta: "#bb9af7",
      brightCyan: "#7dcfff",
      brightWhite: "#c0caf5",
    },
  },
  {
    name: "monokai",
    label: "Monokai",
    colors: {
      background: "#272822",
      foreground: "#f8f8f2",
      cursor: "#f8f8f0",
      selectionBackground: "#49483e",
      black: "#272822",
      red: "#f92672",
      green: "#a6e22e",
      yellow: "#f4bf75",
      blue: "#66d9ef",
      magenta: "#ae81ff",
      cyan: "#a1efe4",
      white: "#f8f8f2",
      brightBlack: "#75715e",
      brightRed: "#fd971f",
      brightGreen: "#a6e22e",
      brightYellow: "#e6db74",
      brightBlue: "#66d9ef",
      brightMagenta: "#ae81ff",
      brightCyan: "#a1efe4",
      brightWhite: "#f9f8f5",
    },
  },
  {
    name: "gruvbox-dark",
    label: "Gruvbox Dark",
    colors: {
      background: "#282828",
      foreground: "#ebdbb2",
      cursor: "#ebdbb2",
      selectionBackground: "#504945",
      black: "#282828",
      red: "#cc241d",
      green: "#98971a",
      yellow: "#d79921",
      blue: "#458588",
      magenta: "#b16286",
      cyan: "#689d6a",
      white: "#a89984",
      brightBlack: "#928374",
      brightRed: "#fb4934",
      brightGreen: "#b8bb26",
      brightYellow: "#fabd2f",
      brightBlue: "#83a598",
      brightMagenta: "#d3869b",
      brightCyan: "#8ec07c",
      brightWhite: "#ebdbb2",
    },
  },
  {
    name: "nord",
    label: "Nord",
    colors: {
      background: "#2e3440",
      foreground: "#d8dee9",
      cursor: "#d8dee9",
      selectionBackground: "#434c5e",
      black: "#3b4252",
      red: "#bf616a",
      green: "#a3be8c",
      yellow: "#ebcb8b",
      blue: "#81a1c1",
      magenta: "#b48ead",
      cyan: "#88c0d0",
      white: "#e5e9f0",
      brightBlack: "#4c566a",
      brightRed: "#bf616a",
      brightGreen: "#a3be8c",
      brightYellow: "#ebcb8b",
      brightBlue: "#81a1c1",
      brightMagenta: "#b48ead",
      brightCyan: "#8fbcbb",
      brightWhite: "#eceff4",
    },
  },
  {
    name: "catppuccin-mocha",
    label: "Catppuccin Mocha",
    colors: {
      background: "#1e1e2e",
      foreground: "#cdd6f4",
      cursor: "#f5e0dc",
      selectionBackground: "#585b7066",
      black: "#45475a",
      red: "#f38ba8",
      green: "#a6e3a1",
      yellow: "#f9e2af",
      blue: "#89b4fa",
      magenta: "#f5c2e7",
      cyan: "#94e2d5",
      white: "#bac2de",
      brightBlack: "#585b70",
      brightRed: "#f38ba8",
      brightGreen: "#a6e3a1",
      brightYellow: "#f9e2af",
      brightBlue: "#89b4fa",
      brightMagenta: "#f5c2e7",
      brightCyan: "#94e2d5",
      brightWhite: "#a6adc8",
    },
  },
  {
    name: "gerry-storm",
    label: "Gerry Storm",
    colors: {
      background: "#082450",
      foreground: "#bbb7b0",
      cursor: "#bbb7b0",
      selectionBackground: "#4a4a4a",
      black: "#3c3c3c",
      red: "#c27e25",
      green: "#587c38",
      yellow: "#c8a033",
      blue: "#4f6f8f",
      magenta: "#a47569",
      cyan: "#4e8c87",
      white: "#bbb7b0",
      brightBlack: "#5a5a5a",
      brightRed: "#e6a339",
      brightGreen: "#7eb84f",
      brightYellow: "#e9c85f",
      brightBlue: "#6c9bcf",
      brightMagenta: "#c48d7e",
      brightCyan: "#6cb4ad",
      brightWhite: "#e0dbd3",
    },
  },
  {
    name: "green-on-black",
    label: "黑底绿字",
    colors: {
      background: "#000000",
      foreground: "#00ff00",
      cursor: "#00ff00",
      selectionBackground: "#003300",
      black: "#003300",
      red: "#00aa00",
      green: "#00ff00",
      yellow: "#00dd00",
      blue: "#009900",
      magenta: "#00bb00",
      cyan: "#00ee00",
      white: "#00ff00",
      brightBlack: "#006600",
      brightRed: "#00cc00",
      brightGreen: "#33ff33",
      brightYellow: "#22ff22",
      brightBlue: "#00aa00",
      brightMagenta: "#11ff11",
      brightCyan: "#44ff44",
      brightWhite: "#66ff66",
    },
  },
  {
    name: "classic-white",
    label: "经典白",
    colors: {
      background: "#ffffff",
      foreground: "#333333",
      cursor: "#333333",
      selectionBackground: "#b3d7ff",
      black: "#333333",
      red: "#cc0000",
      green: "#00a400",
      yellow: "#a68a00",
      blue: "#0000cc",
      magenta: "#cc00cc",
      cyan: "#00a4cc",
      white: "#cccccc",
      brightBlack: "#666666",
      brightRed: "#e50000",
      brightGreen: "#00d600",
      brightYellow: "#d6d600",
      brightBlue: "#3333ff",
      brightMagenta: "#e500e5",
      brightCyan: "#00d6d6",
      brightWhite: "#ffffff",
    },
  },
  {
    name: "solarized-light",
    label: "暖光",
    colors: {
      background: "#fdf6e3",
      foreground: "#657b83",
      cursor: "#586e75",
      selectionBackground: "#eee8d5",
      black: "#073642",
      red: "#dc322f",
      green: "#859900",
      yellow: "#b58900",
      blue: "#268bd2",
      magenta: "#d33682",
      cyan: "#2aa198",
      white: "#eee8d5",
      brightBlack: "#002b36",
      brightRed: "#cb4b16",
      brightGreen: "#586e75",
      brightYellow: "#657b83",
      brightBlue: "#839496",
      brightMagenta: "#6c71c4",
      brightCyan: "#93a1a1",
      brightWhite: "#fdf6e3",
    },
  },
  {
    name: "paper",
    label: "旧纸张",
    colors: {
      background: "#f5f0e8",
      foreground: "#3c3836",
      cursor: "#504945",
      selectionBackground: "#d5c8b2",
      black: "#3c3836",
      red: "#9d0006",
      green: "#79740e",
      yellow: "#b57614",
      blue: "#076678",
      magenta: "#8f3f71",
      cyan: "#427b58",
      white: "#f5f0e8",
      brightBlack: "#665c54",
      brightRed: "#cc241d",
      brightGreen: "#98971a",
      brightYellow: "#d79921",
      brightBlue: "#458588",
      brightMagenta: "#b16286",
      brightCyan: "#689d6a",
      brightWhite: "#fbf1c7",
    },
  },
];

// LLM Provider 相关类型

export interface LlmProviderModel {
  id: string;
  providerId: string;
  modelName: string;
  isDefault: boolean;
  sortOrder: number;
  createdAt: number;
}

export interface LlmProvider {
  id: string;
  name: string;
  providerKind: "anthropic" | "openai" | "google" | "custom";
  authType: AuthType;
  baseUrl: string | null;
  icon: string | null;
  color: string | null;
  isPreset: boolean;
  isActive: boolean;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
  models: LlmProviderModel[];
  apiKey?: string;
  oauthToken?: string;
}

export interface CreateLlmProviderInput {
  name: string;
  providerKind: "anthropic" | "openai" | "google" | "custom";
  authType?: AuthType;
  baseUrl?: string;
  icon?: string;
  color?: string;
  models: string[];
  defaultModel?: string;
  apiKey?: string;
  oauthToken?: string;
}

export interface UpdateLlmProviderInput {
  name?: string;
  providerKind?: "anthropic" | "openai" | "google" | "custom";
  authType?: AuthType;
  baseUrl?: string;
  icon?: string;
  color?: string;
  models?: string[];
  defaultModel?: string;
  isActive?: boolean;
  apiKey?: string;
  oauthToken?: string;
}

export interface PresetProviderView {
  name: string;
  providerKind: "anthropic" | "openai" | "google" | "custom";
  baseUrl: string;
  icon: string;
  color: string;
  models: string[];
}

/** CLI 工具兼容的 provider_kind 映射 */
export const TOOL_PROVIDER_KIND_MAP: Record<
  string,
  ReadonlyArray<"anthropic" | "openai" | "google" | "custom">
> = {
  claude: ["anthropic"],
  codex: ["openai"],
  gemini: ["google"],
  opencode: ["anthropic", "openai", "google", "custom"],
};
