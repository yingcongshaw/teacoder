import { Button, Tooltip, Badge } from "antd";
import {
  SearchOutlined,
  ReloadOutlined,
  ToolOutlined,
  SettingOutlined,
  QuestionCircleOutlined,
} from "@ant-design/icons";
import { useAppStore } from "../../stores/appStore";
import { detectCliTools } from "../../utils/ipc";
import { TOOL_DISPLAY_NAMES } from "../../types";
import WindowControls, { isMac } from "../common/WindowControls";

export default function AppHeader() {
  const cliTools = useAppStore((s) => s.cliTools);
  const setCliTools = useAppStore((s) => s.setCliTools);
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const settingsPage = useAppStore((s) => s.settingsPage);
  const setSettingsPage = useAppStore((s) => s.setSettingsPage);
  const sessions = useAppStore((s) => s.sessions);
  const projects = useAppStore((s) => s.projects);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const setManualGuideOpen = useAppStore((s) => s.setManualGuideOpen);

  const handleRedetect = () => {
    detectCliTools().then(setCliTools).catch(() => {});
  };

  const availableTools = cliTools.filter((t) => t.isAvailable);
  const activeTab = sessions.find((t) => t.id === activeTabId);

  return (
    <div className="flex-shrink-0">
      <div
        className="flex items-center h-9 bg-[var(--ant-color-bg-container)] text-[var(--ant-color-text)] select-none"
        data-tauri-drag-region
      >
        {/* Left: logo + title */}
        <div
          className="flex items-center gap-2 flex-shrink-0"
          style={{ width: isMac ? 200 : 160, paddingLeft: isMac ? 76 : 12 }}
          data-tauri-drag-region
        >
          <img
            src="/logo.png"
            alt="TeaCoder"
            className="h-5 w-5 flex-shrink-0"
            draggable={false}
            data-tauri-drag-region
          />
          <span className="text-[13px] font-medium text-[var(--ant-color-text-secondary)] truncate" data-tauri-drag-region>
            TeaCoder
          </span>
        </div>

        {/* Center: info bar */}
        <div className="flex-1 flex justify-center items-center" data-tauri-drag-region>
          {activeTab && (
            <div className="flex items-center gap-3 text-xs text-[var(--ant-color-text-tertiary)]">
              <span className="flex items-center gap-1">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ backgroundColor: activeTab.color || "var(--ant-color-text-tertiary)" }}
                />
                <span className="text-[var(--ant-color-text)] font-medium">
                  {TOOL_DISPLAY_NAMES[activeTab.toolType]}
                </span>
              </span>
              <span className="text-[var(--ant-color-text-quaternary)]">|</span>
              <span className="truncate max-w-xs">{projects.find((p) => p.id === activeTab.projectId)?.name || activeTab.projectId}</span>
            </div>
          )}
        </div>

        {/* Right: tool status + actions + window controls */}
        <div className="flex items-center flex-shrink-0 justify-end" style={{ width: isMac ? 200 : 220, paddingRight: isMac ? 12 : 0 }}>
          <div className="flex items-center gap-1">
            <Tooltip title="帮助 / 新手引导">
              <Button
                type="text"
                size="small"
                icon={<QuestionCircleOutlined style={{ fontSize: 13 }} />}
                onClick={() => setManualGuideOpen(true)}
              />
            </Tooltip>

            <Tooltip title="已检测工具">
              <Button
                type="text"
                size="small"
                icon={
                  <Badge
                    count={availableTools.length}
                    size="small"
                    offset={[2, -2]}
                  >
                    <ToolOutlined style={{ fontSize: 13 }} />
                  </Badge>
                }
              />
            </Tooltip>

            <Tooltip title="重新检测 CLI 工具">
              <Button
                type="text"
                size="small"
                icon={<ReloadOutlined style={{ fontSize: 13 }} />}
                onClick={handleRedetect}
              />
            </Tooltip>

            <Tooltip title="搜索 (Ctrl+P)">
              <Button
                type="text"
                size="small"
                icon={<SearchOutlined style={{ fontSize: 13 }} />}
                onClick={() => setSearchOpen(true)}
              />
            </Tooltip>

            <Tooltip title={settingsPage ? "返回终端" : "设置"}>
              <Button
                type="text"
                size="small"
                icon={<SettingOutlined style={{ fontSize: 13 }} />}
                onClick={() => setSettingsPage(!settingsPage)}
                className={settingsPage ? "text-[var(--ant-color-primary)]" : ""}
              />
            </Tooltip>
          </div>

          {!isMac && <WindowControls />}
        </div>
      </div>
      {/* Accent gradient bar */}
      <div style={{ height: 2, background: "linear-gradient(90deg, #fa8c16, #3b82f6, #722ed1)" }} />
    </div>
  );
}
