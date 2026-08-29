import { useState, useEffect, useMemo } from "react";
import { Select, Switch, Slider, Input, message, Typography } from "antd";
import SettingRow from "./components/SettingRow";
import SectionHeader from "./components/SectionHeader";
import { useAppStore } from "../../stores/appStore";
import { TERMINAL_COLOR_THEMES } from "../../types";
import type { TerminalSettings } from "../../types";
import { listSystemFonts } from "../../utils/ipc";

const SHELL_OPTIONS = [
  { value: "default", label: "默认 Shell" },
  { value: "bash", label: "Bash" },
  { value: "zsh", label: "Zsh" },
  { value: "fish", label: "Fish" },
  { value: "pwsh", label: "PowerShell" },
  { value: "cmd", label: "CMD" },
];

const BUILTIN_FONTS = [
  "Consolas",
  "JetBrains Mono",
  "Fira Code",
  "Source Code Pro",
  "Cascadia Code",
  "Monaco",
  "Courier New",
  "Menlo",
];

interface LocalFont {
  family: string;
  style: string;
}

async function querySystemFonts(): Promise<string[]> {
  // 优先使用 Rust 端读取的系统字体（跨平台支持）
  try {
    const rustFonts = await listSystemFonts();
    if (rustFonts.length > 0) {
      return rustFonts;
    }
  } catch {
    // Rust 调用失败，回退到浏览器 API
  }

  // 回退方案：使用浏览器的 queryLocalFonts API（仅 Chromium）
  try {
    if ("queryLocalFonts" in window) {
      const fonts = await (window as unknown as { queryLocalFonts: () => Promise<LocalFont[]> }).queryLocalFonts();
      const families = new Set<string>();
      for (const f of fonts) {
        families.add(f.family);
      }
      return Array.from(families).sort((a, b) => a.localeCompare(b));
    }
  } catch {
    // 权限被拒绝或不支持
  }
  return [];
}

interface TerminalSettingsPageProps {
  searchText?: string;
}

export default function TerminalSettingsPage({ searchText = "" }: TerminalSettingsPageProps) {
  const settings = useAppStore((s) => s.terminalSettings);
  const updateSetting = useAppStore((s) => s.updateTerminalSetting);
  const [systemFonts, setSystemFonts] = useState<string[]>([]);
  const [fontSearch, setFontSearch] = useState("");

  useEffect(() => {
    querySystemFonts().then(setSystemFonts);
  }, []);

  const fontOptions = useMemo(() => {
    const allFonts = systemFonts.length > 0 ? systemFonts : BUILTIN_FONTS;
    const filtered = fontSearch
      ? allFonts.filter((f) => f.toLowerCase().includes(fontSearch.toLowerCase()))
      : allFonts;
    return filtered;
  }, [systemFonts, fontSearch]);

  const handleUpdate = <K extends keyof TerminalSettings>(
    key: K,
    value: TerminalSettings[K]
  ) => {
    updateSetting(key, value);
    message.success("设置已保存");
  };

  const matchesSearch = (label: string, desc?: string) => {
    if (!searchText) return true;
    const q = searchText.toLowerCase();
    return label.toLowerCase().includes(q) || (desc && desc.toLowerCase().includes(q));
  };

  return (
    <div>
      {/* Shell */}
      <SectionHeader title="Shell" />
      {matchesSearch("默认 Shell") && (
        <SettingRow label="默认 Shell" description="选择终端使用的 Shell 程序">
          <Select
            value={settings.shell}
            onChange={(v) => handleUpdate("shell", v)}
            style={{ width: 160 }}
          >
            {SHELL_OPTIONS.map((s) => (
              <Select.Option key={s.value} value={s.value}>{s.label}</Select.Option>
            ))}
          </Select>
        </SettingRow>
      )}
      {matchesSearch("Shell 参数") && (
        <SettingRow label="Shell 参数" description="启动 Shell 时传递的额外参数">
          <Input
            value={settings.shellArgs}
            onChange={(e) => handleUpdate("shellArgs", e.target.value)}
            placeholder="例如：-l -v"
            style={{ width: 200 }}
          />
        </SettingRow>
      )}

      {/* 外观 */}
      <SectionHeader title="外观" />
      {matchesSearch("跟随应用主题") && (
        <SettingRow
          label="跟随应用主题"
          description="开启后终端配色随通用设置中的应用主题联动，关闭时使用下方独立配色"
        >
          <Switch
            checked={settings.followAppTheme}
            onChange={(v) => handleUpdate("followAppTheme", v)}
          />
        </SettingRow>
      )}
      {matchesSearch("配色主题") && (
        <div style={{ padding: "6px 0", borderBottom: "1px solid var(--ant-color-border-secondary)" }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ant-color-text)", lineHeight: "20px", marginBottom: 8 }}>
            配色主题
          </div>
          <div
            className="flex gap-2 flex-wrap"
            style={{ maxWidth: 600 }}
          >
            {TERMINAL_COLOR_THEMES.map((t) => {
              const isSelected = settings.colorTheme === t.name;
              return (
                <div
                  key={t.name}
                  onClick={() => !settings.followAppTheme && handleUpdate("colorTheme", t.name)}
                  className="flex-shrink-0 cursor-pointer rounded-lg border-2 p-2 transition-all hover:border-[var(--ant-color-primary-border)]"
                  style={{
                    borderColor: isSelected ? "var(--ant-color-primary)" : "var(--ant-color-border-secondary)",
                    backgroundColor: isSelected ? "var(--ant-color-primary-bg)" : "transparent",
                    opacity: settings.followAppTheme ? 0.5 : 1,
                    minWidth: 90,
                  }}
                >
                  {/* Color preview row */}
                  <div
                    className="flex gap-0.5 rounded mb-1"
                    style={{
                      backgroundColor: t.colors.background,
                      padding: "3px 4px",
                      height: 24,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {["red", "green", "yellow", "blue", "magenta", "cyan", "foreground"].map((k) => (
                      <span
                        key={k}
                        style={{
                          display: "inline-block",
                          width: 6,
                          height: 6,
                          borderRadius: 1,
                          backgroundColor: t.colors[k as keyof typeof t.colors] || t.colors.foreground,
                        }}
                      />
                    ))}
                  </div>
                  {/* Theme name */}
                  <div
                    className="text-center text-xs truncate"
                    style={{
                      color: isSelected ? "var(--ant-color-primary)" : "var(--ant-color-text-secondary)",
                      fontWeight: isSelected ? 600 : 400,
                    }}
                  >
                    {t.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {matchesSearch("字体") && (
        <SettingRow label="字体" description="终端使用的等宽字体，默认 Consolas">
          <Select
            value={settings.fontFamily}
            onChange={(v) => handleUpdate("fontFamily", v)}
            style={{ width: 200 }}
            showSearch
            filterOption={false}
            onSearch={setFontSearch}
            dropdownRender={(menu) => (
              <>
                {menu}
                <div style={{ padding: "4px 8px", borderTop: "1px solid var(--ant-color-border)" }}>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    {systemFonts.length > 0 ? `已加载 ${systemFonts.length} 个系统字体` : "使用内置字体列表"}
                  </Typography.Text>
                </div>
              </>
            )}
            options={fontOptions.map((f) => ({
              value: f,
              label: f,
            }))}
          />
        </SettingRow>
      )}
      {matchesSearch("字号") && (
        <SettingRow label="字号" description="终端文字大小">
          <div style={{ width: 200, display: "flex", alignItems: "center", gap: 8 }}>
            <Slider
              min={10}
              max={20}
              step={1}
              value={settings.fontSize}
              onChange={(v) => handleUpdate("fontSize", v)}
              style={{ flex: 1, margin: 0 }}
            />
            <span style={{ fontSize: 12, color: "var(--ant-color-text-secondary)", minWidth: 24, textAlign: "right" }}>
              {settings.fontSize}
            </span>
          </div>
        </SettingRow>
      )}
      {matchesSearch("行高") && (
        <SettingRow label="行高" description="终端行间距倍数（1.0-2.0）">
          <div style={{ width: 200, display: "flex", alignItems: "center", gap: 8 }}>
            <Slider
              min={1.0}
              max={2.0}
              step={0.1}
              value={settings.lineHeight}
              onChange={(v) => handleUpdate("lineHeight", v)}
              style={{ flex: 1, margin: 0 }}
            />
            <span style={{ fontSize: 12, color: "var(--ant-color-text-secondary)", minWidth: 24, textAlign: "right" }}>
              {settings.lineHeight.toFixed(1)}
            </span>
          </div>
        </SettingRow>
      )}
      {matchesSearch("光标样式") && (
        <SettingRow label="光标样式" description="终端光标的显示形状">
          <Select
            value={settings.cursorStyle}
            onChange={(v) => handleUpdate("cursorStyle", v)}
            style={{ width: 160 }}
          >
            <Select.Option value="block">方块 (Block)</Select.Option>
            <Select.Option value="bar">竖线 (Bar)</Select.Option>
            <Select.Option value="underline">横线 (Underline)</Select.Option>
          </Select>
        </SettingRow>
      )}
      {matchesSearch("光标闪烁") && (
        <SettingRow label="光标闪烁" description="终端光标是否闪烁">
          <Switch
            checked={settings.cursorBlink}
            onChange={(v) => handleUpdate("cursorBlink", v)}
          />
        </SettingRow>
      )}

      {/* 缓冲区 */}
      <SectionHeader title="缓冲区" />
      {matchesSearch("滚动缓冲区") && (
        <SettingRow label="滚动缓冲区" description="保留的终端输出行数">
          <div style={{ width: 200, display: "flex", alignItems: "center", gap: 8 }}>
            <Slider
              min={1000}
              max={50000}
              step={1000}
              value={settings.scrollback}
              onChange={(v) => handleUpdate("scrollback", v)}
              style={{ flex: 1, margin: 0 }}
            />
            <span style={{ fontSize: 12, color: "var(--ant-color-text-secondary)", minWidth: 32, textAlign: "right" }}>
              {settings.scrollback >= 1000 ? `${settings.scrollback / 1000}K` : settings.scrollback}
            </span>
          </div>
        </SettingRow>
      )}
      {matchesSearch("回滚时暂停") && (
        <SettingRow label="回滚时暂停" description="滚动查看历史输出时暂停自动滚动">
          <Switch
            checked={settings.scrollOnOutput}
            onChange={(v) => handleUpdate("scrollOnOutput", v)}
          />
        </SettingRow>
      )}

      {/* 行为 */}
      <SectionHeader title="行为" />
      {matchesSearch("终端响铃") && (
        <SettingRow label="终端响铃" description="终端发出 BEL 字符时播放提示音">
          <Switch
            checked={settings.bell}
            onChange={(v) => handleUpdate("bell", v)}
          />
        </SettingRow>
      )}
      {matchesSearch("复制选中内容") && (
        <SettingRow label="复制选中内容" description="选中文本时自动复制到剪贴板">
          <Switch
            checked={settings.copyOnSelect}
            onChange={(v) => handleUpdate("copyOnSelect", v)}
          />
        </SettingRow>
      )}
      {matchesSearch("右键粘贴") && (
        <SettingRow label="右键粘贴" description="右键点击时粘贴剪贴板内容">
          <Switch
            checked={settings.rightClickPaste}
            onChange={(v) => handleUpdate("rightClickPaste", v)}
          />
        </SettingRow>
      )}

      {/* 环境变量 */}
      <SectionHeader title="环境变量" />
      {matchesSearch("自定义环境变量") && (
        <SettingRow label="自定义环境变量" description="每行一个，格式：KEY=VALUE">
          <Input.TextArea
            value={settings.envVars}
            onChange={(e) => handleUpdate("envVars", e.target.value)}
            rows={4}
            placeholder={`NODE_OPTIONS=--max-old-space-size=4096\nPYTHONPATH=/usr/local/lib/python3.9`}
            style={{ width: 320, fontFamily: "monospace", fontSize: 12 }}
          />
        </SettingRow>
      )}
    </div>
  );
}
