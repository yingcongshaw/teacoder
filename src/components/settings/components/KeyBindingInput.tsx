import { useState, KeyboardEvent, useRef } from "react";
import { Tag } from "antd";

interface KeyBindingInputProps {
  value: string;
  onChange: (value: string) => void;
}

export default function KeyBindingInput({ value, onChange }: KeyBindingInputProps) {
  const [recording, setRecording] = useState(false);
  const [keys, setKeys] = useState<string[]>([]);
  const inputRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const parts: string[] = [];
    if (e.ctrlKey || e.metaKey) parts.push(e.ctrlKey ? "Ctrl" : "Cmd");
    if (e.shiftKey) parts.push("Shift");
    if (e.altKey) parts.push("Alt");

    const key = e.key;
    if (!["Control", "Shift", "Alt", "Meta"].includes(key)) {
      parts.push(key.length === 1 ? key.toUpperCase() : key);
      const binding = parts.join("+");
      onChange(binding);
      setRecording(false);
      setKeys([]);
    } else {
      setKeys(parts);
    }
  };

  const handleBlur = () => {
    setRecording(false);
    setKeys([]);
  };

  return (
    <div
      ref={inputRef}
      tabIndex={0}
      onKeyDown={recording ? handleKeyDown : undefined}
      onFocus={() => setRecording(true)}
      onBlur={handleBlur}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        minHeight: 28,
        minWidth: 120,
        borderRadius: 4,
        border: recording
          ? "1px solid var(--ant-color-primary)"
          : "1px solid var(--ant-color-border)",
        background: recording ? "var(--ant-color-primary-bg)" : "var(--ant-color-bg-container)",
        cursor: "pointer",
        outline: "none",
        transition: "border-color 0.2s, background 0.2s",
      }}
    >
      {recording ? (
        keys.length > 0 ? (
          keys.map((k, i) => (
            <Tag key={i} style={{ margin: 0, fontSize: 11 }}>
              {k}
            </Tag>
          ))
        ) : (
          <span style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)" }}>
            按下快捷键...
          </span>
        )
      ) : value ? (
        value.split("+").map((k, i) => (
          <Tag key={i} style={{ margin: 0, fontSize: 11 }}>
            {k}
          </Tag>
        ))
      ) : (
        <span style={{ fontSize: 12, color: "var(--ant-color-text-quaternary)" }}>
          点击设置
        </span>
      )}
    </div>
  );
}
