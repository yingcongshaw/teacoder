import { useState, useEffect } from "react";
import {
  Card,
  List,
  Button,
  Tag,
  Modal,
  Typography,
  Empty,
  Dropdown,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  MoreOutlined,
} from "@ant-design/icons";
import { useAppStore } from "../../stores/appStore";
import { listProfiles, deleteProfile } from "../../utils/ipc";
import { TOOL_DISPLAY_NAMES } from "../../types";
import type { Profile, ToolType } from "../../types";
import ProfileFormModal from "./ProfileFormModal";

const TOOL_COLORS: Record<ToolType, string> = {
  claude: "#d97706",
  codex: "#1677ff",
  gemini: "#52c41a",
  opencode: "#722ed1",
};

export default function ProfileManager() {
  const profiles = useAppStore((s) => s.profiles);
  const setProfiles = useAppStore((s) => s.setProfiles);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const refreshProfiles = () => {
    listProfiles().then(setProfiles).catch(() => {});
  };

  useEffect(() => {
    refreshProfiles();
  }, []);

  const handleCreate = () => {
    setEditingId(null);
    setFormOpen(true);
  };

  const handleEdit = (profile: Profile) => {
    setEditingId(profile.id);
    setFormOpen(true);
  };

  const handleDelete = (profile: Profile) => {
    Modal.confirm({
      title: "删除 Profile",
      content: profile.appDataRoot
        ? `确定删除「${profile.name}」？该 Profile 的数据隔离目录不会被删除。`
        : `确定删除「${profile.name}」？`,
      okText: "删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: () => {
        deleteProfile(profile.id, { removeData: false })
          .then(refreshProfiles)
          .catch(() => {});
      },
    });
  };

  const grouped = profiles.reduce<Record<string, Profile[]>>(
    (acc, p) => {
      if (!acc[p.toolType]) acc[p.toolType] = [];
      acc[p.toolType].push(p);
      return acc;
    },
    {},
  );

  return (
    <div className="p-4 h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <Typography.Title level={4} className="m-0">
          Profile 管理
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
          新建 Profile
        </Button>
      </div>

      {profiles.length === 0 ? (
        <Empty description="暂无 Profile，点击上方按钮创建" />
      ) : (
        Object.entries(grouped).map(([toolType, items]) => (
          <Card
            key={toolType}
            title={
              <span>
                <Tag color={TOOL_COLORS[toolType as ToolType]}>
                  {TOOL_DISPLAY_NAMES[toolType as ToolType]}
                </Tag>
                <span className="text-sm text-gray-500">
                  {items.length} 个 Profile
                </span>
              </span>
            }
            size="small"
            className="mb-3"
          >
            <List
              dataSource={items}
              renderItem={(profile) => (
                <List.Item
                  actions={[
                    <Dropdown
                      key="more"
                      menu={{
                        items: [
                          {
                            key: "edit",
                            icon: <EditOutlined />,
                            label: "编辑",
                            onClick: () => handleEdit(profile),
                          },
                          {
                            key: "delete",
                            icon: <DeleteOutlined />,
                            label: "删除",
                            danger: true,
                            onClick: () => handleDelete(profile),
                          },
                        ],
                      }}
                      trigger={["click"]}
                    >
                      <Button type="text" size="small" icon={<MoreOutlined />} />
                    </Dropdown>,
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <span>
                        <span
                          className="inline-block w-2 h-2 rounded-full mr-2"
                          style={{ backgroundColor: profile.color || "#888" }}
                        />
                        {profile.name}
                        <Tag className="ml-2" color={profile.authType === "oauth" ? "green" : "blue"}>
                          {profile.authType === "oauth" ? "OAuth" : "API Key"}
                        </Tag>
                      </span>
                    }
                    description={
                      <div className="text-xs text-gray-400">
                        {profile.appDataRoot && (
                          <div>数据目录: {profile.appDataRoot}</div>
                        )}
                        {profile.baseUrl && (
                          <div>API: {profile.baseUrl}</div>
                        )}
                        {profile.description}
                      </div>
                    }
                  />
                </List.Item>
              )}
            />
          </Card>
        ))
      )}

      <ProfileFormModal
        open={formOpen}
        editingId={editingId}
        onClose={() => setFormOpen(false)}
      />
    </div>
  );
}
