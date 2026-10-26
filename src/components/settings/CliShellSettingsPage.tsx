import { Input, App } from "antd";
import SettingRow from "./components/SettingRow";
import SectionHeader from "./components/SectionHeader";
import { useAppStore } from "../../stores/appStore";
import QuickCommandsEditor from "../quick-commands/QuickCommandsEditor";

interface CliShellSettingsPageProps {
  /** shell 类工具（terminal / ssh），决定快捷命令的归属 */
  toolType: string;
  searchText?: string;
}

export default function CliShellSettingsPage({
  toolType,
  searchText = "",
}: CliShellSettingsPageProps) {
  const { message } = App.useApp();
  const envVars = useAppStore((s) => s.terminalSettings.envVars);
  const updateSetting = useAppStore((s) => s.updateTerminalSetting);

  const handleUpdate = (value: string) => {
    updateSetting("envVars", value);
    message.success("设置已保存");
  };

  const matchesSearch = (label: string, desc?: string) => {
    if (!searchText) return true;
    const q = searchText.toLowerCase();
    return label.toLowerCase().includes(q) || (desc && desc.toLowerCase().includes(q));
  };

  return (
    <div>
      <SectionHeader title="环境变量" />
      {matchesSearch("自定义环境变量") && (
        <SettingRow label="自定义环境变量" description="每行一个，格式：KEY=VALUE（全局生效）">
          <Input.TextArea
            value={envVars}
            onChange={(e) => handleUpdate(e.target.value)}
            rows={4}
            placeholder={`NODE_OPTIONS=--max-old-space-size=4096\nPYTHONPATH=/usr/local/lib/python3.9`}
            style={{ width: 320, fontFamily: "monospace", fontSize: 12 }}
          />
        </SettingRow>
      )}

      {matchesSearch("快捷命令") && <QuickCommandsEditor toolType={toolType} />}
    </div>
  );
}
