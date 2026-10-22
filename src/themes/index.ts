// Theme system for TeaCoder
// Each theme defines Ant Design token overrides + Tailwind dark class handling

import { TERMINAL_COLOR_THEMES } from "../types";
import { withAlpha, solidColor } from "../utils/color";

export interface ThemeConfig {
  key: string;
  label: string;
  description?: string;
  algorithm: "dark" | "light";
  // Ant Design token overrides
  token?: Record<string, string | number>;
  // Tailwind dark-mode class (applied to html element)
  tailwindClass?: string;
  // Preview color for theme selector
  previewColors: [string, string, string]; // primary, bg, text
}

export const BUILT_IN_THEMES: ThemeConfig[] = [
  {
    key: "system",
    label: "跟随系统",
    description: "自动跟随操作系统主题",
    algorithm: "dark",
    previewColors: ["#1677ff", "#141414", "#ffffff"],
  },
  {
    key: "dark",
    label: "深色",
    description: "默认深色主题",
    algorithm: "dark",
    token: {
      colorBgBase: "#141414",
      colorTextBase: "#ffffff",
      colorPrimary: "#1677ff",
      colorBorder: "#424242",
    },
    tailwindClass: "dark",
    previewColors: ["#1677ff", "#141414", "#ffffff"],
  },
  {
    key: "light",
    label: "浅色",
    description: "默认浅色主题",
    algorithm: "light",
    token: {
      colorBgBase: "#ffffff",
      colorTextBase: "#000000",
      colorPrimary: "#1677ff",
      colorBorder: "#d9d9d9",
    },
    tailwindClass: "",
    previewColors: ["#1677ff", "#ffffff", "#000000"],
  },
  // IDE-style themes
  {
    key: "one-dark",
    label: "One Dark",
    description: "Atom One Dark 风格",
    algorithm: "dark",
    token: {
      colorBgBase: "#282c34",
      // 原版 #abb2bf 的 tertiary 档仅 4.48:1，略微提亮至 AA 以上，色相饱和度不变
      colorTextBase: "#b1b7c3",
      colorPrimary: "#61afef",
      colorBorder: "#3e4451",
      colorSuccess: "#98c379",
      colorWarning: "#e5c07b",
      colorError: "#e06c75",
    },
    tailwindClass: "dark",
    previewColors: ["#61afef", "#282c34", "#b1b7c3"],
  },
  {
    key: "monokai",
    label: "Monokai",
    description: "Monokai 经典配色",
    algorithm: "dark",
    token: {
      colorBgBase: "#272822",
      colorTextBase: "#f8f8f2",
      colorPrimary: "#66d9ef",
      colorBorder: "#49483e",
      colorSuccess: "#a6e22e",
      colorWarning: "#e6db74",
      colorError: "#f92672",
    },
    tailwindClass: "dark",
    previewColors: ["#66d9ef", "#272822", "#f8f8f2"],
  },
  {
    key: "dracula",
    label: "Dracula",
    description: "Dracula 暗色主题",
    algorithm: "dark",
    token: {
      colorBgBase: "#282a36",
      colorTextBase: "#f8f8f2",
      colorPrimary: "#bd93f9",
      colorBorder: "#44475a",
      colorSuccess: "#50fa7b",
      colorWarning: "#f1fa8c",
      colorError: "#ff5555",
    },
    tailwindClass: "dark",
    previewColors: ["#bd93f9", "#282a36", "#f8f8f2"],
  },
  {
    key: "solarized-dark",
    label: "Solarized Dark",
    description: "Solarized 暗色",
    algorithm: "dark",
    token: {
      colorBgBase: "#002b36",
      // Solarized 原版 base0 偏灰，colorText 档仅 4.43:1，提亮至 AA 以上
      colorTextBase: "#abb6b8",
      colorPrimary: "#268bd2",
      colorBorder: "#073642",
      colorSuccess: "#859900",
      colorWarning: "#b58900",
      colorError: "#dc322f",
    },
    tailwindClass: "dark",
    previewColors: ["#268bd2", "#002b36", "#abb6b8"],
  },
  {
    key: "solarized-light",
    label: "Solarized Light",
    description: "Solarized 浅色",
    algorithm: "light",
    token: {
      colorBgBase: "#fdf6e3",
      // 浅色主题，文字需比原版 base00 明显加深才够对比度（原值 tertiary 仅 2.62:1）
      colorTextBase: "#354145",
      colorPrimary: "#268bd2",
      colorBorder: "#eee8d5",
      colorSuccess: "#859900",
      colorWarning: "#b58900",
      colorError: "#dc322f",
    },
    tailwindClass: "",
    previewColors: ["#268bd2", "#fdf6e3", "#354145"],
  },
  {
    key: "github-storm",
    label: "GitHub Storm",
    description: "GitHub 蓝色主题",
    algorithm: "dark",
    token: {
      colorBgBase: "#031733",
      colorTextBase: "#ffffff",
      colorPrimary: "#58a6ff",
      colorBorder: "#30363d",
      colorSuccess: "#3fb950",
      colorWarning: "#d29922",
      colorError: "#f85149",
    },
    tailwindClass: "dark",
    previewColors: ["#58a6ff", "#0d1117", "#ffffff"], //#c9d1d9
  },
  {
    key: "high-contrast",
    label: "高对比度",
    description: "高对比度无障碍主题",
    algorithm: "dark",
    token: {
      colorBgBase: "#000000",
      colorTextBase: "#ffffff",
      colorPrimary: "#ffff00",
      colorBorder: "#ffffff",
      colorSuccess: "#00ff00",
      colorWarning: "#ffff00",
      colorError: "#ff0000",
      borderRadius: 0,
    },
    tailwindClass: "dark",
    previewColors: ["#ffff00", "#000000", "#ffffff"],
  },
  {
    key: "white-light",
    label: "夏日烈阳",
    description: "暖色调浅色主题，配合白色终端配色",
    algorithm: "light",
    token: {
      colorBgBase: "#fef6e4",
      colorTextBase: "#000000",
      colorPrimary: "#aa5500",
      colorBorder: "#e8dfd0",
      colorSuccess: "#6b8c42",
      colorWarning: "#b8860b",
      colorError: "#c44b4b",
    },
    tailwindClass: "",
    previewColors: ["#ffd997", "#ffeac5", "#fdf6e3"],
  },
  {
    key: "warm-light",
    label: "秋高气爽",
    description: "暖色调浅色主题，配合淡黄暖光终端配色",
    algorithm: "light",
    token: {
      colorBgBase: "#ffeac5",
      colorTextBase: "#000000",
      colorPrimary: "#aa5500",
      colorBorder: "#e8dfd0",
      colorSuccess: "#6b8c42",
      colorWarning: "#b8860b",
      colorError: "#c44b4b",
    },
    tailwindClass: "",
    previewColors: ["#ffd997", "#ffeac5", "#fdf6e3"],
  },



  
];

export function getThemeConfig(key: string): ThemeConfig {
  return BUILT_IN_THEMES.find((t) => t.key === key) || BUILT_IN_THEMES[0];
}

/**
 * antd 把 colorTextBase 派生成半透明文字，档位固定为 0.88/0.65/0.45/0.25 且不可配置。
 * 该档位在浅色主题下 colorTextTertiary 仅 3.24:1、colorTextQuaternary 仅 1.81:1，
 * 均低于 WCAG AA 的 4.5:1，且半透明黑覆盖在暖色背景上会洗掉暖色调，故显式覆盖四档。
 */
export function buildTextTokens(
  token?: Record<string, string | number>,
): Record<string, string> {
  const base = String(token?.colorTextBase ?? "#000000");
  return {
    colorText: withAlpha(base, 0.95),
    colorTextSecondary: withAlpha(base, 0.85),
    colorTextTertiary: withAlpha(base, 0.75),
    colorTextQuaternary: withAlpha(base, 0.65),
    // tab 条上未激活页签专用，比 quaternary 更淡以拉开与激活项的差距
    colorTextInactive: withAlpha(base, 0.6),
  };
}

/**
 * 背景层次：从 colorBgBase 派生容器底、布局底和边框色。
 *
 * WHY: antd 固定使用 container=0 / layout=4 / border=15 三个暗化档，
 * 导致布局底比容器底深太多、边框在浅色主题下发灰发脏，故收紧为 0 / 2 / 8。
 */
export function buildBgTokens(
  token?: Record<string, string | number>,
): Record<string, string> {
  const base = String(token?.colorBgBase ?? "#ffffff");
  return {
    colorBgContainer: solidColor(base, 0),
    colorBgLayout: solidColor(base, 2),
    colorBorder: solidColor(base, 8),
  };
}

export function resolveTheme(
  themeKey: string,
  systemDark: boolean,
): ThemeConfig {
  if (themeKey === "system") {
    return systemDark
      ? getThemeConfig("dark")
      : getThemeConfig("light");
  }
  return getThemeConfig(themeKey);
}

/**
 * 应用主题 -> 终端配色主题映射。
 * 同名主题直接匹配（one-dark/monokai/dracula/solarized-light），
 * 无对应终端配色时按深浅算法回退：深色 -> tokyo-night，浅色 -> classic-white。
 */
export function terminalThemeForAppTheme(
  themeKey: string,
  systemDark: boolean,
): string {
  const resolved = resolveTheme(themeKey, systemDark);
  if (TERMINAL_COLOR_THEMES.some((t) => t.name === resolved.key)) {
    return resolved.key;
  }
  return resolved.algorithm === "dark" ? "tokyo-night" : "classic-white";
}
