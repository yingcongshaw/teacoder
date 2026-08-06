interface SectionHeaderProps {
  title: string;
}

export default function SectionHeader({ title }: SectionHeaderProps) {
  return (
    <div
      style={{
        paddingTop: 16,
        paddingBottom: 6,
        marginBottom: 0,
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "var(--ant-color-text-quaternary)",
          textTransform: "uppercase",
          letterSpacing: "0.8px",
        }}
      >
        {title}
      </span>
    </div>
  );
}
