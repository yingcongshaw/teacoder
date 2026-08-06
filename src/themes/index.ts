// Theme system for CodingTea
// Each theme defines Ant Design token overrides + Tailwind dark class handling

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
      colorTextBase: "#abb2bf",
      colorPrimary: "#61afef",
      colorBorder: "#3e4451",
      colorSuccess: "#98c379",
      colorWarning: "#e5c07b",
      colorError: "#e06c75",
    },
    tailwindClass: "dark",
    previewColors: ["#61afef", "#282c34", "#abb2bf"],
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
      colorTextBase: "#839496",
      colorPrimary: "#268bd2",
      colorBorder: "#073642",
      colorSuccess: "#859900",
      colorWarning: "#b58900",
      colorError: "#dc322f",
    },
    tailwindClass: "dark",
    previewColors: ["#268bd2", "#002b36", "#839496"],
  },
  {
    key: "solarized-light",
    label: "Solarized Light",
    description: "Solarized 浅色",
    algorithm: "light",
    token: {
      colorBgBase: "#fdf6e3",
      colorTextBase: "#657b83",
      colorPrimary: "#268bd2",
      colorBorder: "#eee8d5",
      colorSuccess: "#859900",
      colorWarning: "#b58900",
      colorError: "#dc322f",
    },
    tailwindClass: "",
    previewColors: ["#268bd2", "#fdf6e3", "#657b83"],
  },
  {
    key: "github-dark",
    label: "GitHub Dark",
    description: "GitHub 暗色主题",
    algorithm: "dark",
    token: {
      colorBgBase: "#0d1117",
      colorTextBase: "#c9d1d9",
      colorPrimary: "#58a6ff",
      colorBorder: "#30363d",
      colorSuccess: "#3fb950",
      colorWarning: "#d29922",
      colorError: "#f85149",
    },
    tailwindClass: "dark",
    previewColors: ["#58a6ff", "#0d1117", "#c9d1d9"],
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
];

export function getThemeConfig(key: string): ThemeConfig {
  return BUILT_IN_THEMES.find((t) => t.key === key) || BUILT_IN_THEMES[0];
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
