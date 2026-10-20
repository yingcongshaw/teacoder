import { Input } from "antd";
import { SearchOutlined } from "@ant-design/icons";

interface SettingsSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export default function SettingsSearchBar({
  value,
  onChange,
  placeholder = "搜索设置...",
}: SettingsSearchBarProps) {
  return (
    <Input
      prefix={<SearchOutlined style={{ color: "var(--ant-color-text-quaternary)" }} />}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      allowClear
      style={{ width: 240, borderRadius: 6 }}
    />
  );
}
