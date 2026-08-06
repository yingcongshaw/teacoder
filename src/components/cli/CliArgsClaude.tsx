import { useState } from "react";
import { Switch, Input, InputNumber, Tooltip } from "antd";
import { FolderOpenOutlined } from "@ant-design/icons";
import { open } from "@tauri-apps/api/dialog";

interface CliArgsClaudeProps {
  value: Record<string, unknown>;
  onChange: (val: Record<string, unknown>) => void;
}

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 11,
  color: "#aaaaaa",
  minWidth: 90,
  flexShrink: 0,
};

const ROW_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 8,
};

const INPUT_STYLE: React.CSSProperties = {
  backgroundColor: "#252830",
  borderColor: "#2a2d38",
  color: "#cccccc",
  fontSize: 12,
};

export default function CliArgsClaude({ value, onChange }: CliArgsClaudeProps) {
  const [tagsInput, setTagsInput] = useState({
    allowedTools: (value.allowedTools as string[] || []).join(", "),
    disallowedTools: (value.disallowedTools as string[] || []).join(", "),
  });

  const update = (key: string, val: unknown) => {
    onChange({ ...value, [key]: val });
  };

  const parseTagInput = (text: string): string[] =>
    text.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);

  const handleMcpConfigBrowse = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (selected && typeof selected === "string") {
        update("mcpConfig", selected);
      }
    } catch {
      // 用户取消
    }
  };

  return (
    <div className="space-y-1">
      <div style={ROW_STYLE}>
        <Tooltip title="跳过所有权限确认提示">
          <span style={LABEL_STYLE}>跳过权限</span>
        </Tooltip>
        <Switch
          size="small"
          checked={!!value.dangerouslySkipPermissions}
          onChange={(v) => update("dangerouslySkipPermissions", v || undefined)}
        />
      </div>

      <div style={ROW_STYLE}>
        <Tooltip title="允许使用的工具列表，逗号分隔">
          <span style={LABEL_STYLE}>限制工具</span>
        </Tooltip>
        <Input
          size="small"
          placeholder="Bash, Read, Write..."
          value={tagsInput.allowedTools}
          style={{ ...INPUT_STYLE, flex: 1 }}
          onChange={(e) => {
            setTagsInput((prev) => ({ ...prev, allowedTools: e.target.value }));
            update("allowedTools", parseTagInput(e.target.value));
          }}
        />
      </div>

      <div style={ROW_STYLE}>
        <Tooltip title="禁用的工具列表，逗号分隔">
          <span style={LABEL_STYLE}>禁用工具</span>
        </Tooltip>
        <Input
          size="small"
          placeholder="Bash, Edit..."
          value={tagsInput.disallowedTools}
          style={{ ...INPUT_STYLE, flex: 1 }}
          onChange={(e) => {
            setTagsInput((prev) => ({ ...prev, disallowedTools: e.target.value }));
            update("disallowedTools", parseTagInput(e.target.value));
          }}
        />
      </div>

      <div style={ROW_STYLE}>
        <Tooltip title="最大对话轮数">
          <span style={LABEL_STYLE}>最大轮数</span>
        </Tooltip>
        <InputNumber
          size="small"
          min={1}
          max={1000}
          placeholder="无限制"
          value={(value.maxTurns as number) || undefined}
          style={{ ...INPUT_STYLE, width: 100 }}
          onChange={(v) => update("maxTurns", v ?? undefined)}
        />
      </div>

      <div style={{ ...ROW_STYLE, alignItems: "flex-start" }}>
        <Tooltip title="追加到系统提示的内容">
          <span style={{ ...LABEL_STYLE, marginTop: 4 }}>追加提示</span>
        </Tooltip>
        <Input.TextArea
          size="small"
          rows={2}
          placeholder="追加到系统提示的文本..."
          value={(value.appendSystemPrompt as string) || ""}
          style={{ ...INPUT_STYLE, flex: 1, resize: "vertical" }}
          onChange={(e) => update("appendSystemPrompt", e.target.value || undefined)}
        />
      </div>

      <div style={ROW_STYLE}>
        <Tooltip title="启用详细日志输出">
          <span style={LABEL_STYLE}>详细日志</span>
        </Tooltip>
        <Switch
          size="small"
          checked={!!value.verbose}
          onChange={(v) => update("verbose", v || undefined)}
        />
      </div>

      <div style={ROW_STYLE}>
        <Tooltip title="MCP 服务器配置文件路径">
          <span style={LABEL_STYLE}>MCP 配置</span>
        </Tooltip>
        <Input
          size="small"
          placeholder="~/.config/claude/mcp.json"
          value={(value.mcpConfig as string) || ""}
          style={{ ...INPUT_STYLE, flex: 1 }}
          onChange={(e) => update("mcpConfig", e.target.value || undefined)}
          suffix={
            <FolderOpenOutlined
              style={{ color: "#888888", cursor: "pointer", fontSize: 12 }}
              onClick={handleMcpConfigBrowse}
            />
          }
        />
      </div>
    </div>
  );
}
