import { useEffect, useRef, useState } from "react";
import { Modal, Input, List } from "antd";
import type { InputRef } from "antd";
import { useAppStore } from "../../stores/appStore";
import { TOOL_DISPLAY_NAMES } from "../../types";

export default function SearchPanel() {
  const searchOpen = useAppStore((s) => s.searchOpen);
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const sessions = useAppStore((s) => s.sessions);
  const openTab = useAppStore((s) => s.openTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const openTabIds = useAppStore((s) => s.openTabIds);
  const [query, setQuery] = useState("");
  const inputRef = useRef<InputRef>(null);

  useEffect(() => {
    if (searchOpen) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [searchOpen]);

  const filtered = query
    ? sessions.filter(
        (t) =>
          t.title.toLowerCase().includes(query.toLowerCase()) ||
          TOOL_DISPLAY_NAMES[t.toolType].toLowerCase().includes(query.toLowerCase()) ||
          t.workDir.toLowerCase().includes(query.toLowerCase()),
      )
    : sessions;

  const handleSelect = (tabId: string) => {
    if (openTabIds.includes(tabId)) {
      setActiveTab(tabId);
    } else {
      openTab(tabId);
    }
    setSearchOpen(false);
  };

  return (
    <Modal
      open={searchOpen}
      onCancel={() => setSearchOpen(false)}
      footer={null}
      closable={false}
      width={480}
      styles={{ body: { padding: 0 } }}
    >
      <div className="p-3 border-b border-gray-200 dark:border-gray-700">
        <Input
          ref={inputRef}
          placeholder="搜索会话..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          allowClear
        />
      </div>
      <List
        className="max-h-64 overflow-y-auto"
        dataSource={filtered}
        renderItem={(tab) => (
          <List.Item
            className="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 px-3"
            onClick={() => handleSelect(tab.id)}
          >
            <List.Item.Meta
              title={
                <span>
                  <span
                    className="inline-block w-2 h-2 rounded-full mr-2"
                    style={{ backgroundColor: tab.color || "#888" }}
                  />
                  {tab.title || TOOL_DISPLAY_NAMES[tab.toolType]}
                </span>
              }
              description={tab.workDir}
            />
          </List.Item>
        )}
        locale={{ emptyText: "无匹配会话" }}
      />
    </Modal>
  );
}
