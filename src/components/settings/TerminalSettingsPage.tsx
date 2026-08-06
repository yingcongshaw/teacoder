import { Select, Switch, Slider, Input, message } from "antd";
import SettingRow from "./components/SettingRow";
import SectionHeader from "./components/SectionHeader";
import { useAppStore } from "../../stores/appStore";
import { TERMINAL_COLOR_THEMES } from "../../types";
import type { TerminalSettings } from "../../types";

const SHELL_OPTIONS = [
  { value: "default", label: "默认 Shell" },
  { value: "bash", label: "Bash" },
  { value: "zsh", label: "Zsh" },
  { value: "fish", label: "Fish" },
  { value: "pwsh", label: "PowerShell" },
  { value: "cmd", label: "CMD" },
];

const FONT_OPTIONS = [
  { value: "JetBrains Mono", label: "JetBrains Mono" },
  { value: "Fira Code", label: "Fira Code" },
  { value: "Source Code Pro", label: "Source Code Pro" },
  { value: "Cascadia Code", label: "Cascadia Code" },
  { value: "Consolas", label: "Consolas" },
  { value: "Monaco", label: "Monaco" },
];

interface TerminalSettingsPageProps {
  searchText?: string;
}

export default function TerminalSettingsPage({ searchText = "" }: TerminalSettingsPageProps) {
  const settings = useAppStore((s) => s.terminalSettings);
  const updateSetting = useAppStore((s) => s.updateTerminalSetting);

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
      {matchesSearch("字体") && (
        <SettingRow label="字体" description="终端使用的等宽字体">
          <Select
            value={settings.fontFamily}
            onChange={(v) => handleUpdate("fontFamily", v)}
            style={{ width: 200 }}
          >
            {FONT_OPTIONS.map((f) => (
              <Select.Option key={f.value} value={f.value}>{f.label}</Select.Option>
            ))}
          </Select>
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
        <SettingRow label="行高" description="终端行间距倍数">
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
      {matchesSearch("配色主题") && (
        <SettingRow label="配色主题" description="终端配色方案">
          <Select
            value={settings.colorTheme}
            onChange={(v) => handleUpdate("colorTheme", v)}
            style={{ width: 200 }}
          >
            {TERMINAL_COLOR_THEMES.map((t) => (
              <Select.Option key={t.name} value={t.name}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ display: "flex", gap: 2 }}>
                    {["background", "red", "green", "yellow", "blue", "magenta", "cyan", "foreground"].map((k) => (
                      <span
                        key={k}
                        style={{
                          display: "inline-block",
                          width: 8,
                          height: 8,
                          borderRadius: 2,
                          backgroundColor: t.colors[k as keyof typeof t.colors],
                        }}
                      />
                    ))}
                  </div>
                  <span>{t.label}</span>
                </div>
              </Select.Option>
            ))}
          </Select>
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
