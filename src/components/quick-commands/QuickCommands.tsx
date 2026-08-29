import React, { useEffect, useRef } from "react";
import { useAppStore } from "../../stores/appStore";
import { writeToPty } from "../../utils/ipc";

const COMMANDS: Record<string, string[]> = {
  claude: [
    "继续",
    "任务完成了吗？没完成的话继续",
    "使用Playwright来测试和验证",
    "代码审查",
    "Bug修复",
  ],
  terminal: [
    "pnpm run dev:antd",
    "pnpm run build:antd",
    "pnpm tauri dev",
    "pnpm tauri build",
  ],
};

interface QuickCommandsProps {
  visible: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

export default function QuickCommands({ visible, onClose, anchorRef }: QuickCommandsProps) {
  const activeTabId = useAppStore((s) => s.activeTabId);
  const sessions = useAppStore((s) => s.sessions);
  const panelRef = useRef<HTMLDivElement>(null);

  const activeTab = sessions.find((s) => s.id === activeTabId);
  const toolType = activeTab?.toolType ?? "claude";
  const commands = COMMANDS[toolType] ?? COMMANDS.claude;

  useEffect(() => {
    if (!visible) return;

    const handleClickOutside = (e: MouseEvent) => {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (
        anchor &&
        !anchor.contains(e.target as Node) &&
        panel &&
        !panel.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [visible, anchorRef, onClose]);

  if (!visible) return null;

  const handleCommandClick = async (cmd: string) => {
    if (activeTabId) {
      await writeToPty(activeTabId, cmd);
    }
    onClose();
  };

  return (
    <div
      ref={panelRef}
      className="absolute bottom-full mb-1 right-0 z-50 bg-[var(--ant-color-bg-elevated)] border border-[var(--ant-color-border)] rounded-lg shadow-lg min-w-[200px] py-1"
      style={{ boxShadow: "0 6px 16px 0 rgba(0, 0, 0, 0.16)" }}
    >
      {commands.map((cmd, idx) => (
        <div
          key={idx}
          className="px-3 py-1.5 text-xs cursor-pointer transition-colors"
          style={{
            color: "var(--ant-color-text)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "var(--ant-color-primary-bg)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "transparent";
          }}
          onClick={() => handleCommandClick(cmd)}
        >
          {cmd}
        </div>
      ))}
    </div>
  );
}
