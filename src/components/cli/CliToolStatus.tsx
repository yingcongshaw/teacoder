import { Tooltip } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { useAppStore } from "../../stores/appStore";
import { detectCliTools } from "../../utils/ipc";

const TOOL_ICONS: Record<string, string> = {
  claude: "/claude.png",
  codex: "/codex.png",
  gemini: "/gemini.png",
  opencode: "/opencode.png",
};

export default function CliToolStatus() {
  const cliTools = useAppStore((s) => s.cliTools);
  const setCliTools = useAppStore((s) => s.setCliTools);

  const handleRedetect = () => {
    detectCliTools().then(setCliTools).catch(() => {});
  };

  return (
    <div className="px-3 pt-3 pb-1 flex items-center gap-1.5 flex-shrink-0">
      {cliTools.map((tool) => (
        <Tooltip
          key={tool.toolType}
          title={
            tool.isAvailable
              ? `${tool.version || "未知版本"} · ${tool.path || ""}`
              : "未安装"
          }
        >
          <div
            className="w-6 h-6 rounded flex items-center justify-center cursor-default"
            style={{
              opacity: tool.isAvailable ? 1 : 0.3,
              filter: tool.isAvailable ? "none" : "grayscale(1)",
            }}
          >
            <img
              src={TOOL_ICONS[tool.toolType]}
              alt={tool.toolType}
              className="w-5 h-5"
              draggable={false}
            />
          </div>
        </Tooltip>
      ))}
      <Tooltip title="重新检测">
        <ReloadOutlined
          className="text-[10px] text-[#555555] cursor-pointer hover:text-[#cccccc] ml-auto"
          onClick={handleRedetect}
        />
      </Tooltip>
    </div>
  );
}
