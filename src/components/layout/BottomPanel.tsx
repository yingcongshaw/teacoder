import { useState, useMemo } from "react";
import { Tabs, Button, Tooltip, Input, Tree, Tag, Empty } from "antd";
import type { TreeDataNode } from "antd";
import {
  FileOutlined,
  FolderOutlined,
  BranchesOutlined,
  CodeOutlined,
  UnorderedListOutlined,
  DownOutlined,
  UpOutlined,
  EnterOutlined,
  BulbOutlined,
  CheckOutlined,
  SendOutlined,
  ClearOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { useAppStore } from "../../stores/appStore";
import { writeToPty } from "../../utils/ipc";

const COMMON_COMMANDS: Record<string, string[]> = {
  claude: [
    "/help",
    "/clear",
    "/model",
    "/cost",
    "/status",
    "/resume",
    "继续",
    "请解释这段代码",
    "请重构这个函数",
  ],
  codex: [
    "/help",
    "/model",
    "/clear",
    "继续",
    "请解释这段代码",
    "请重构这个函数",
  ],
  gemini: [
    "/help",
    "/clear",
    "/model",
    "继续",
    "请解释这段代码",
    "请重构这个函数",
  ],
  opencode: [
    "/help",
    "/clear",
    "/model",
    "继续",
    "请解释这段代码",
    "请重构这个函数",
  ],
};

const QUICK_ACTIONS = [
  { key: "continue", label: "继续", text: "继续", icon: <EnterOutlined /> },
  { key: "suggest", label: "建议", text: "请给出你的建议", icon: <BulbOutlined /> },
  { key: "accept", label: "采纳", text: "采纳上述方案并继续", icon: <CheckOutlined /> },
  { key: "submit", label: "提交", text: "请提交代码", icon: <SendOutlined /> },
];

export default function BottomPanel() {
  const sessions = useAppStore((s) => s.sessions);
  const projects = useAppStore((s) => s.projects);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const [collapsed, setCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState("files");
  const [inputValue, setInputValue] = useState("");

  const activeTabState = useMemo(
    () => sessions.find((t) => t.id === activeTabId),
    [sessions, activeTabId],
  );

  const commands = activeTabState
    ? COMMON_COMMANDS[activeTabState.toolType] || []
    : [];

  const fileTreeData: TreeDataNode[] = useMemo(() => {
    if (!activeTabState) return [];
    return [
      {
        key: "root",
        title: projects.find((p) => p.id === activeTabState.projectId)?.name || "项目",
        icon: <FolderOutlined />,
        children: [
          {
            key: "src",
            title: "src",
            icon: <FolderOutlined />,
            children: [
              { key: "1", title: "main.ts", icon: <FileOutlined /> },
              { key: "2", title: "App.tsx", icon: <FileOutlined /> },
            ],
          },
          {
            key: "docs",
            title: "docs",
            icon: <FolderOutlined />,
            children: [
              { key: "3", title: "README.md", icon: <FileOutlined /> },
            ],
          },
          { key: "4", title: "package.json", icon: <FileOutlined /> },
        ],
      },
    ];
  }, [activeTabState]);

  const sendToTerminal = (text: string) => {
    if (!activeTabId || !text.trim()) return;
    writeToPty(activeTabId, text + "\n").catch(() => {});
    setInputValue("");
  };

  const handleClearConversation = () => {
    if (!activeTabId) return;
    writeToPty(activeTabId, "/clear\n").catch(() => {});
  };

  if (!activeTabState) {
    return null;
  }

  if (collapsed) {
    return (
      <div className="border-t border-[var(--ant-color-border)] bg-[var(--ant-color-bg-container)] h-8 flex items-center justify-between px-3 flex-shrink-0">
        <span className="text-xs text-[var(--ant-color-text-tertiary)]">底部面板已折叠</span>
        <Button
          size="small"
          type="text"
          icon={<UpOutlined />}
          onClick={() => setCollapsed(false)}
        />
      </div>
    );
  }

  return (
    <div className="border-t border-[var(--ant-color-border)] bg-[var(--ant-color-bg-container)] flex flex-col flex-shrink-0" style={{ height: 220 }}>
      <div className="flex items-center justify-between px-2 py-1 border-b border-[var(--ant-color-border)] flex-shrink-0">
        <Tabs
          size="small"
          activeKey={activeTab}
          onChange={setActiveTab}
          type="card"
          style={{ minHeight: 28 }}
          items={[
            { key: "files", label: <span><FileOutlined /> 文件树</span> },
            { key: "git", label: <span><BranchesOutlined /> Git</span> },
            { key: "commands", label: <span><CodeOutlined /> 指令</span> },
            { key: "tasks", label: <span><UnorderedListOutlined /> 任务</span> },
          ]}
        />
        <div className="flex items-center gap-1 flex-shrink-0">
          <Tooltip title="清空对话">
            <Button
              size="small"
              type="text"
              icon={<ClearOutlined />}
              onClick={handleClearConversation}
            />
          </Tooltip>
          <Button
            size="small"
            type="text"
            icon={<DownOutlined />}
            onClick={() => setCollapsed(true)}
          />
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex min-h-0">
        <div className="flex-1 overflow-auto p-2 min-w-0">
          {activeTab === "files" && (
            <Tree
              showIcon
              treeData={fileTreeData}
              defaultExpandAll
              className="bg-transparent"
            />
          )}
          {activeTab === "git" && (
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <BranchesOutlined />
                <span className="text-[var(--ant-color-text-tertiary)]">当前分支:</span>
                <Tag color="blue">main</Tag>
              </div>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="暂无未提交的更改"
              />
            </div>
          )}
          {activeTab === "commands" && (
            <div className="flex flex-wrap gap-1">
              {commands.map((cmd) => (
                <Tag
                  key={cmd}
                  className="cursor-pointer"
                  onClick={() => sendToTerminal(cmd)}
                >
                  {cmd}
                </Tag>
              ))}
            </div>
          )}
          {activeTab === "tasks" && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无后台任务"
            />
          )}
        </div>

        <div className="w-56 border-l border-[var(--ant-color-border-secondary)] p-2 flex flex-col gap-2 flex-shrink-0 overflow-y-auto">
          <div className="text-xs text-[var(--ant-color-text-tertiary)] mb-1">快捷输入</div>
          <div className="grid grid-cols-2 gap-1">
            {QUICK_ACTIONS.map((action) => (
              <Button
                key={action.key}
                size="small"
                icon={action.icon}
                onClick={() => sendToTerminal(action.text)}
              >
                {action.label}
              </Button>
            ))}
          </div>
          <Input.Search
            size="small"
            placeholder="输入指令..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onSearch={sendToTerminal}
            enterButton={<SendOutlined />}
          />
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => activeTabId && writeToPty(activeTabId, "/resume\n").catch(() => {})}
          >
            恢复对话
          </Button>
        </div>
      </div>
    </div>
  );
}
