import { useState, useEffect } from "react";
import { Switch, Input, InputNumber, Button, App } from "antd";
import { ArrowRightOutlined } from "@ant-design/icons";
import { useAppStore } from "../../stores/appStore";
import { getToolSettings, upsertToolSettings } from "../../utils/ipc";
import type { Profile } from "../../types";
import SettingRow from "./components/SettingRow";
import SectionHeader from "./components/SectionHeader";
import QuickCommandsEditor from "../quick-commands/QuickCommandsEditor";


const PERMISSION_MODES = [
  { value: "default", label: "默认" },
  { value: "relaxed", label: "宽松" },
  { value: "strict", label: "严格" },
];

interface ClaudeSettings {
  model: string;
  autoSubmit: boolean;
  permissionMode: string;
  maxOutputLength: number;
  customInstructions: string;
}

const DEFAULT_SETTINGS: ClaudeSettings = {
  model: "claude-sonnet-4",
  autoSubmit: false,
  permissionMode: "default",
  maxOutputLength: 8192,
  customInstructions: "",
};

interface ClaudeSettingsPageProps {
  searchText?: string;
}

export default function ClaudeSettingsPage({ searchText = "" }: ClaudeSettingsPageProps) {
  const { message } = App.useApp();
  const [settings, setSettings] = useState<ClaudeSettings>(DEFAULT_SETTINGS);
  
  const profiles = useAppStore((s) => s.profiles);
  const setSettingsActiveKey = useAppStore((s) => s.setSettingsActiveKey);
  const claudeProfiles = profiles.filter((p) => p.toolType === "claude");
  const activeProfile: Profile | undefined = claudeProfiles[0];

  useEffect(() => {
    if (activeProfile) {
      loadSettings(activeProfile.id);
    }
  }, [activeProfile?.id]);

  const loadSettings = async (profileId: string) => {
    try {
      const data = await getToolSettings(profileId);
      if (data) {
        setSettings({
          model: data.model || DEFAULT_SETTINGS.model,
          autoSubmit: data.autoSubmit || DEFAULT_SETTINGS.autoSubmit,
          permissionMode: "default",
          maxOutputLength: DEFAULT_SETTINGS.maxOutputLength,
          customInstructions: data.customInstructions || DEFAULT_SETTINGS.customInstructions,
        });

      }
    } catch {
      message.error("加载设置失败");
    }
  };

  const saveToBackend = async (next: ClaudeSettings) => {
    if (!activeProfile) return;
    try {
      await upsertToolSettings({
        profileId: activeProfile.id,
        toolType: "claude",
        model: next.model,
        autoSubmit: next.autoSubmit,
        customInstructions: next.customInstructions,
        settingsJson: JSON.stringify({
          permissionMode: next.permissionMode,
          maxOutputLength: next.maxOutputLength,
        }),
      });
      message.success("设置已保存");
    } catch {
      message.error("保存失败");
    }
  };

  const updateSetting = <K extends keyof ClaudeSettings>(
    key: K,
    value: ClaudeSettings[K]
  ) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    saveToBackend(next);
  };

  const matchesSearch = (label: string, desc?: string) => {
    if (!searchText) return true;
    const q = searchText.toLowerCase();
    return label.toLowerCase().includes(q) || (desc && desc.toLowerCase().includes(q));
  };

  if (!activeProfile) {
    return (
      <div
        style={{
          padding: "64px 24px",
          textAlign: "center",
          color: "var(--ant-color-text-secondary)",
        }}
      >
        <div style={{ fontSize: 14, marginBottom: 16 }}>
          暂无 Claude Code Profile
        </div>
        <div style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)", marginBottom: 24 }}>
          请先在 Profile 管理中创建一个 Claude Code Profile，然后再配置模型、快捷命令等。
        </div>
        <Button
          type="primary"
          icon={<ArrowRightOutlined />}
          onClick={() => setSettingsActiveKey("profile-management")}
        >
          前往 Profile 管理
        </Button>
      </div>
    );
  }

  return (
    <div>
      {/* 行为 */}
      <SectionHeader title="行为" />
      {matchesSearch("自动提交") && (
        <SettingRow label="自动提交" description="开启后，Claude 生成的代码修改将自动应用到文件">
          <Switch
            checked={settings.autoSubmit}
            onChange={(v) => updateSetting("autoSubmit", v)}
          />
        </SettingRow>
      )}
      {matchesSearch("权限模式") && (
        <SettingRow label="权限模式" description="控制 Claude 执行操作的确认级别">
          <div className="flex gap-1">
            {PERMISSION_MODES.map((m) => {
              const isSelected = settings.permissionMode === m.value;
              return (
                <div
                  key={m.value}
                  onClick={() => updateSetting("permissionMode", m.value)}
                  style={{
                    padding: "4px 12px",
                    borderRadius: 4,
                    fontSize: 12,
                    cursor: "pointer",
                    border: `1px solid ${isSelected ? "var(--ant-color-primary)" : "var(--ant-color-border)"}`,
                    background: isSelected ? "var(--ant-color-primary-bg)" : "transparent",
                    color: isSelected ? "var(--ant-color-primary)" : "var(--ant-color-text-secondary)",
                    fontWeight: isSelected ? 500 : 400,
                    transition: "all 0.15s",
                  }}
                >
                  {m.label}
                </div>
              );
            })}
          </div>
        </SettingRow>
      )}
      {matchesSearch("最大输出长度") && (
        <SettingRow label="最大输出长度" description="单次请求的最大输出 Token 数">
          <InputNumber
            value={settings.maxOutputLength}
            onChange={(v) => v && updateSetting("maxOutputLength", v)}
            min={1024}
            max={65536}
            step={1024}
            style={{ width: 120 }}
          />
        </SettingRow>
      )}

      {/* 自定义指令 */}
      <SectionHeader title="自定义指令" />
      {matchesSearch("全局自定义指令") && (
        <div style={{ padding: "8px 0", borderBottom: "1px solid var(--ant-color-border-secondary)" }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ant-color-text)", marginBottom: 4 }}>
            全局自定义指令
          </div>
          <div style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)", marginBottom: 8 }}>
            这些指令将附加到每个会话中，影响 Claude 的行为方式
          </div>
          <Input.TextArea
            value={settings.customInstructions}
            onChange={(e) => updateSetting("customInstructions", e.target.value)}
            rows={5}
            placeholder={`- 始终使用中文回复\n- 代码注释使用英文\n- 优先使用函数式编程风格`}
            style={{ fontFamily: "monospace", fontSize: 12 }}
          />
        </div>
      )}

      {matchesSearch("快捷命令") && <QuickCommandsEditor toolType="claude" />}
    </div>
  );
}
