import { Tooltip } from "antd";
import { MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import { useAppStore } from "../../stores/appStore";

/**
 * 左侧栏折叠/展开按钮。固定占据右侧区顶栏最左侧的 50px 槽位，
 * 折叠后槽位保留，图标翻转为展开态。
 */
export default function SidebarToggle() {
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);

  return (
    <Tooltip title={collapsed ? "展开侧边栏" : "收起侧边栏"} placement="bottom">
      <button
        type="button"
        onClick={toggleSidebar}
        aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
        style={{
          width: 50,
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          border: "none",
          background: "transparent",
          cursor: "pointer",
          color: "var(--ant-color-text-secondary)",
          fontSize: 14,
          transition: "color 0.15s, background-color 0.15s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "var(--ant-color-text)";
          e.currentTarget.style.backgroundColor = "var(--ant-color-fill-quaternary)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "var(--ant-color-text-secondary)";
          e.currentTarget.style.backgroundColor = "transparent";
        }}
      >
        {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
      </button>
    </Tooltip>
  );
}
