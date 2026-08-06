import { useEffect, useState } from "react";
import { Typography, Select, Tooltip, Tag } from "antd";
import {
  GithubOutlined,
} from "@ant-design/icons";
import { useAppStore } from "../../stores/appStore";
import { getProfileCost, getGlobalCost, getToolSettings, upsertToolSettings } from "../../utils/ipc";
import { TOOL_DISPLAY_NAMES } from "../../types";
import type { CostSummary, Profile, ToolSettings } from "../../types";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(3)}`;
  if (usd > 0) return `$${usd.toFixed(4)}`;
  return "$0";
}

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
  const costTick = useAppStore((s) => s.costTick);
  const activeTab = sessions.find((t) => t.id === activeTabId);

  const [profileCost, setProfileCost] = useState<CostSummary | null>(null);
  const [globalCost, setGlobalCost] = useState<CostSummary | null>(null);
  const [toolSettings, setToolSettings] = useState<ToolSettings | null>(null);
  const [model, setModel] = useState<string>("claude-sonnet-4");
  const [thinkingIntensity, setThinkingIntensity] = useState<string>("medium");

  const activeProfile: Profile | undefined = activeTab
    ? profiles.find((p) => p.id === activeTab.profileId)
    : undefined;

  useEffect(() => {
    if (activeTab?.profileId) {
      getProfileCost(activeTab.profileId)
        .then(setProfileCost)
        .catch(() => {});
    } else {
      setProfileCost(null);
    }
  }, [activeTab?.profileId, costTick]);

  useEffect(() => {
    getGlobalCost()
      .then(setGlobalCost)
      .catch(() => {});
  }, [costTick]);

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

  const totalTokens = profileCost
    ? profileCost.inputTokens + profileCost.outputTokens + profileCost.cacheCreationTokens + profileCost.cacheReadTokens
    : 0;

  const isClaude = activeTab?.toolType === "claude";

  return (
    <div className="flex items-center h-7 px-3 text-xs border-t border-[#333333] bg-[#0d0d0d] text-[#888888] flex-shrink-0">
      {activeTab ? (
        <>
          {/* Left: tool info */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <span>{TOOL_DISPLAY_NAMES[activeTab.toolType]}</span>
            <span className="text-[#333333]">|</span>
            <span>{activeProfile ? activeProfile.name : "未选择 Profile"}</span>
          </div>

          <span className="mx-2 text-[#333333]">|</span>

          {/* Center: token stats */}
          <div className="flex items-center gap-2 flex-1">
            {profileCost && totalTokens > 0 ? (
              <>
                <span>
                  In: {formatTokens(profileCost.inputTokens)} Out: {formatTokens(profileCost.outputTokens)} Cache: {formatTokens(profileCost.cacheCreationTokens + profileCost.cacheReadTokens)}
                </span>
                <span className="text-[#333333]">|</span>
                <span>{formatCost(profileCost.costUsd)}</span>
              </>
            ) : (
              <span>Token: --</span>
            )}
          </div>

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
                <span className="text-[#333333]">|</span>
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
                <span className="text-[#333333]">|</span>
              </>
            )}
            <span className="cursor-pointer hover:text-[#e0e0e0]">继续</span>
            <span className="text-[#333333]">|</span>
            <span className="cursor-pointer hover:text-[#e0e0e0]">建议</span>
            <span className="text-[#333333]">|</span>
            <span className="cursor-pointer hover:text-[#e0e0e0]">采纳</span>
            <span className="text-[#333333]">|</span>
            <GithubOutlined className="cursor-pointer hover:text-[#e0e0e0]" />
          </div>

          {/* Far right: global cost */}
          {globalCost && globalCost.costUsd > 0 && (
            <span className="ml-4 flex-shrink-0">本月累计: {formatCost(globalCost.costUsd)}</span>
          )}
        </>
      ) : (
        <Typography.Text type="secondary" className="text-xs">
          茶码 CodingTea v0.1
        </Typography.Text>
      )}
    </div>
  );
}
