import { ReactNode } from "react";

interface SettingRowProps {
  label: string;
  description?: string;
  children: ReactNode;
  indent?: boolean;
}

export default function SettingRow({
  label,
  description,
  children,
  indent = false,
}: SettingRowProps) {
  return (
    <div
      className="flex items-center justify-between"
      style={{
        minHeight: 40,
        padding: "6px 0",
        borderBottom: "1px solid var(--ant-color-border-secondary)",
        paddingLeft: indent ? 24 : 0,
      }}
    >
      <div className="flex-1 min-w-0 pr-6">
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: "var(--ant-color-text)",
            lineHeight: "20px",
          }}
        >
          {label}
        </div>
        {description && (
          <div
            style={{
              fontSize: 12,
              color: "var(--ant-color-text-tertiary)",
              lineHeight: "18px",
              marginTop: 1,
            }}
          >
            {description}
          </div>
        )}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}
