// 跨平台 UI 字体回退链
const UI_FONT_FALLBACK =
  ", -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', " +
  "'Microsoft YaHei', 'Noto Sans CJK SC', 'Sarasa Sans SC', sans-serif";

export function buildUiFontStack(family: string): string {
  if (!family || family === "system-ui") {
    return `system-ui${UI_FONT_FALLBACK}`;
  }
  // 自动用逗号分隔多字体，并加引号处理含空格的字体名
  const quoted = family.includes(",")
    ? family
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => (/\s/.test(s) ? `"${s}"` : s))
        .join(", ")
    : /\s/.test(family)
      ? `"${family}"`
      : family;
  return `${quoted}${UI_FONT_FALLBACK}`;
}

export const RECOMMENDED_UI_FONTS: { value: string; label: string }[] = [
  { value: "system-ui", label: "跟随系统" },
  { value: "Inter", label: "Inter" },
  { value: "Helvetica Neue", label: "Helvetica Neue" },
  { value: "Segoe UI", label: "Segoe UI" },
  { value: "PingFang SC", label: "苹方（PingFang SC）" },
  { value: "Microsoft YaHei", label: "微软雅黑（Microsoft YaHei）" },
  { value: "Sarasa Sans SC", label: "更纱黑体（Sarasa Sans SC）" },
  { value: "Noto Sans CJK SC", label: "思源黑体（Noto Sans CJK SC）" },
  { value: "Source Han Sans CN", label: "思源黑体（Source Han Sans CN）" },
  { value: "WenQuanYi Micro Hei", label: "文泉驿微米黑" },
];
