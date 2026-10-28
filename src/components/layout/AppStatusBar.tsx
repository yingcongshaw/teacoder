import { useEffect, useState } from "react";
import { Typography, Select, Tooltip, Tag } from "antd";
import {
  GithubOutlined,
} from "@ant-design/icons";
import { useAppStore } from "../../stores/appStore";
import { getToolSettings, upsertToolSettings } from "../../utils/ipc";
import { TOOL_DISPLAY_NAMES } from "../../types";
import type { Profile, ToolSettings } from "../../types";

const CLAUDE_MODELS = [
  { value: "claude-opus-4", label: "Opus 4" },
  { value: "claude-sonnet-4", label: "Sonnet 4" },
  { value: "claude-haiku-4", label: "Haiku 4" },
];

const THINKING_INTENSITIES = [
  { value: "low", label: "思考:低", color: "green" },
  { value: "medium", label: "思考:中", color: "blue" },
  { value: "high", label: "思考:高", color: "purple" },
];

export default function AppStatusBar() {
  const sessions = useAppStore((s) => s.sessions);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const profiles = useAppStore((s) => s.profiles);
  const activeTab = sessions.find((t) => t.id === activeTabId);

  const [toolSettings, setToolSettings] = useState<ToolSettings | null>(null);
  const [model, setModel] = useState<string>("claude-sonnet-4");
  const [thinkingIntensity, setThinkingIntensity] = useState<string>("medium");

  const activeProfile: Profile | undefined = activeTab
    ? profiles.find((p) => p.id === activeTab.profileId)
    : undefined;

  useEffect(() => {
    if (activeProfile?.id) {
      getToolSettings(activeProfile.id)
        .then((data) => {
          setToolSettings(data);
          if (data?.model) setModel(data.model);
          if (data?.thinkingIntensity) setThinkingIntensity(data.thinkingIntensity);
        })
        .catch(() => setToolSettings(null));
    } else {
      setToolSettings(null);
    }
  }, [activeProfile?.id]);

  const handleModelChange = (value: string) => {
    setModel(value);
    if (activeProfile?.id) {
      upsertToolSettings({
        profileId: activeProfile.id,
        toolType: activeProfile.toolType,
        model: value,
        thinkingIntensity,
        autoSubmit: toolSettings?.autoSubmit || false,
        customInstructions: toolSettings?.customInstructions || "",
        settingsJson: toolSettings?.settingsJson,
      }).catch(() => {});
    }
  };

  const handleThinkingChange = (value: string) => {
    setThinkingIntensity(value);
    if (activeProfile?.id) {
      upsertToolSettings({
        profileId: activeProfile.id,
        toolType: activeProfile.toolType,
        model,
        thinkingIntensity: value,
        autoSubmit: toolSettings?.autoSubmit || false,
        customInstructions: toolSettings?.customInstructions || "",
        settingsJson: toolSettings?.settingsJson,
      }).catch(() => {});
    }
  };

  const isClaude = activeTab?.toolType === "claude";

  return (
    <div className="flex items-center h-7 px-3 text-xs border-t border-[var(--ant-color-border)] bg-[var(--ant-color-bg-container)] text-[var(--ant-color-text-tertiary)] flex-shrink-0">
      {activeTab ? (
        <>
          {/* Left: tool info */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <span>{TOOL_DISPLAY_NAMES[activeTab.toolType]}</span>
            <span className="text-[var(--ant-color-border)]">|</span>
            <span>{activeProfile ? activeProfile.name : "未选择 Profile"}</span>
          </div>

          <span className="mx-2 text-[var(--ant-color-border)]">|</span>

          {/* Right: model selector + actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {isClaude && (
              <>
                <Tooltip title="切换模型">
                  <Select
                    size="small"
                    value={model}
                    onChange={handleModelChange}
                    style={{ width: 110 }}
                    options={CLAUDE_MODELS}
                  />
                </Tooltip>
                <span className="text-[var(--ant-color-border)]">|</span>
                <Tooltip title="思考强度">
                  <Select
                    size="small"
                    value={thinkingIntensity}
                    onChange={handleThinkingChange}
                    style={{ width: 90 }}
                    options={THINKING_INTENSITIES}
                    optionRender={(option) => (
                      <Tag color={option.data.color} className="m-0">{option.label}</Tag>
                    )}
                  />
                </Tooltip>
                <span className="text-[var(--ant-color-border)]">|</span>
              </>
            )}
            <span className="cursor-pointer hover:text-[var(--ant-color-text)]">继续</span>
            <span className="text-[var(--ant-color-border)]">|</span>
            <span className="cursor-pointer hover:text-[var(--ant-color-text)]">建议</span>
            <span className="text-[var(--ant-color-border)]">|</span>
            <span className="cursor-pointer hover:text-[var(--ant-color-text)]">采纳</span>
            <span className="text-[var(--ant-color-border)]">|</span>
            <GithubOutlined className="cursor-pointer hover:text-[var(--ant-color-text)]" />
          </div>
        </>
      ) : (
        <Typography.Text type="secondary" className="text-xs">
          TeaCoder v0.1.1
        </Typography.Text>
      )}
    </div>
  );
}
