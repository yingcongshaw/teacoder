import { useState, useEffect } from "react";
import { Select, Switch, Slider, App } from "antd";
import SettingRow from "./components/SettingRow";
import SectionHeader from "./components/SectionHeader";

interface AIAssistantSettings {
  enableCompletion: boolean;
  completionDelay: number;
  completionProvider: string;
  enableInlineEdit: boolean;
  editMode: string;
  chatModel: string;
  contextWindow: string;
  includeFileContext: boolean;
  enableCodeExplanation: boolean;
  explanationDetail: string;
}

const DEFAULT_SETTINGS: AIAssistantSettings = {
  enableCompletion: true,
  completionDelay: 300,
  completionProvider: "builtin",
  enableInlineEdit: true,
  editMode: "line",
  chatModel: "default",
  contextWindow: "8K",
  includeFileContext: true,
  enableCodeExplanation: true,
  explanationDetail: "standard",
};

interface AIAssistantPageProps {
  searchText?: string;
}

export default function AIAssistantPage({ searchText = "" }: AIAssistantPageProps) {
  const { message } = App.useApp();
  const [settings, setSettings] = useState<AIAssistantSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("teacoder_aiassistant_settings");
      const saved = raw ? JSON.parse(raw) : {};
      setSettings({ ...DEFAULT_SETTINGS, ...saved });
    } catch {
      setSettings(DEFAULT_SETTINGS);
    }
  }, []);

  const updateSetting = <K extends keyof AIAssistantSettings>(
    key: K,
    value: AIAssistantSettings[K]
  ) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    localStorage.setItem("teacoder_aiassistant_settings", JSON.stringify(next));
    message.success("设置已保存");
  };

  const matchesSearch = (label: string, desc?: string) => {
    if (!searchText) return true;
    const q = searchText.toLowerCase();
    return label.toLowerCase().includes(q) || (desc && desc.toLowerCase().includes(q));
  };

  return (
    <div>
      {/* 代码补全 */}
      <SectionHeader title="代码补全" />
      {matchesSearch("启用 AI 补全") && (
        <SettingRow label="启用 AI 补全" description="开启 AI 驱动的代码补全功能">
          <Switch
            checked={settings.enableCompletion}
            onChange={(v) => updateSetting("enableCompletion", v)}
          />
        </SettingRow>
      )}
      {matchesSearch("补全延迟") && (
        <SettingRow label="补全延迟" description="输入后等待多久触发补全">
          <div style={{ width: 200, display: "flex", alignItems: "center", gap: 8 }}>
            <Slider
              min={0}
              max={1000}
              step={50}
              value={settings.completionDelay}
              onChange={(v) => updateSetting("completionDelay", v)}
              style={{ flex: 1, margin: 0 }}
            />
            <span style={{ fontSize: 12, color: "var(--ant-color-text-secondary)", minWidth: 40, textAlign: "right" }}>
              {settings.completionDelay}ms
            </span>
          </div>
        </SettingRow>
      )}
      {matchesSearch("补全提供者") && (
        <SettingRow label="补全提供者" description="选择代码补全的来源">
          <Select
            value={settings.completionProvider}
            onChange={(v) => updateSetting("completionProvider", v)}
            style={{ width: 160 }}
          >
            <Select.Option value="builtin">内置</Select.Option>
            <Select.Option value="copilot">Copilot</Select.Option>
            <Select.Option value="tabnine">Tabnine</Select.Option>
          </Select>
        </SettingRow>
      )}

      {/* 内联编辑 */}
      <SectionHeader title="内联编辑" />
      {matchesSearch("启用内联编辑") && (
        <SettingRow label="启用内联编辑" description="在编辑器中直接使用 AI 修改代码">
          <Switch
            checked={settings.enableInlineEdit}
            onChange={(v) => updateSetting("enableInlineEdit", v)}
          />
        </SettingRow>
      )}
      {matchesSearch("编辑模式") && (
        <SettingRow label="编辑模式" description="AI 编辑代码的方式">
          <Select
            value={settings.editMode}
            onChange={(v) => updateSetting("editMode", v)}
            style={{ width: 160 }}
          >
            <Select.Option value="line">逐行</Select.Option>
            <Select.Option value="block">整段</Select.Option>
          </Select>
        </SettingRow>
      )}

      {/* AI 聊天 */}
      <SectionHeader title="AI 聊天" />
      {matchesSearch("聊天模型") && (
        <SettingRow label="聊天模型" description="AI 聊天使用的模型">
          <Select
            value={settings.chatModel}
            onChange={(v) => updateSetting("chatModel", v)}
            style={{ width: 200 }}
          >
            <Select.Option value="default">跟随默认</Select.Option>
            <Select.Option value="claude-opus-4">claude-opus-4</Select.Option>
            <Select.Option value="claude-sonnet-4">claude-sonnet-4</Select.Option>
            <Select.Option value="claude-haiku-4">claude-haiku-4</Select.Option>
          </Select>
        </SettingRow>
      )}
      {matchesSearch("上下文窗口") && (
        <SettingRow label="上下文窗口" description="发送给 AI 的上下文大小">
          <Select
            value={settings.contextWindow}
            onChange={(v) => updateSetting("contextWindow", v)}
            style={{ width: 160 }}
          >
            <Select.Option value="4K">4K</Select.Option>
            <Select.Option value="8K">8K</Select.Option>
            <Select.Option value="16K">16K</Select.Option>
            <Select.Option value="32K">32K</Select.Option>
          </Select>
        </SettingRow>
      )}
      {matchesSearch("包含文件上下文") && (
        <SettingRow label="包含文件上下文" description="将当前文件内容作为上下文发送">
          <Switch
            checked={settings.includeFileContext}
            onChange={(v) => updateSetting("includeFileContext", v)}
          />
        </SettingRow>
      )}

      {/* 代码解释 */}
      <SectionHeader title="代码解释" />
      {matchesSearch("启用代码解释") && (
        <SettingRow label="启用代码解释" description="使用 AI 解释选中的代码">
          <Switch
            checked={settings.enableCodeExplanation}
            onChange={(v) => updateSetting("enableCodeExplanation", v)}
          />
        </SettingRow>
      )}
      {matchesSearch("解释详细度") && (
        <SettingRow label="解释详细度" description="代码解释的详细程度">
          <Select
            value={settings.explanationDetail}
            onChange={(v) => updateSetting("explanationDetail", v)}
            style={{ width: 160 }}
          >
            <Select.Option value="brief">简要</Select.Option>
            <Select.Option value="standard">标准</Select.Option>
            <Select.Option value="detailed">详细</Select.Option>
          </Select>
        </SettingRow>
      )}
    </div>
  );
}
