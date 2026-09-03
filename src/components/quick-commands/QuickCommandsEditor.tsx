import { Input } from "antd";
import { useAppStore } from "../../stores/appStore";
import SectionHeader from "../settings/components/SectionHeader";

interface QuickCommandsEditorProps {
  toolType: string;
  description?: string;
}

const DEFAULT_COMMANDS: Record<string, string> = {
  claude: "继续\n任务完成了吗？没完成的话继续\n使用Playwright来测试和验证\n代码审查\n---\nBug修复",
  terminal: "pnpm run dev:antd\npnpm run build:antd\n---\npnpm tauri dev\npnpm tauri build",
};

export default function QuickCommandsEditor({ toolType, description }: QuickCommandsEditorProps) {
  const value = useAppStore((s) => s.quickCommandsByToolType[toolType] ?? "");
  const update = useAppStore((s) => s.updateQuickCommands);

  const handleChange = (next: string) => {
    update(toolType, next);
  };

  const placeholder = DEFAULT_COMMANDS[toolType] ?? "每行一个快捷命令\n---\n--- 表示分隔线";

  return (
    <div>
      <SectionHeader title="快捷命令" />
      <div style={{ padding: "8px 0", borderBottom: "1px solid var(--ant-color-border-secondary)" }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ant-color-text)", marginBottom: 4 }}>
          快捷命令
        </div>
        <div style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)", marginBottom: 8 }}>
          {description ?? "通过 F2 快捷键调出气泡面板，点击即发送到当前激活会话令；每行一条命令；--- 表示分隔线。"}
        </div>
        <Input.TextArea
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          rows={5}
          placeholder={placeholder}
          style={{ fontFamily: "monospace", fontSize: 12, maxWidth: 480 }}
        />
      </div>
    </div>
  );
}