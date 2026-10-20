import { useState, useEffect } from "react";
import {
  Card,
  Table,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Tag,
  App,
  Space,
  Popconfirm,
  ColorPicker,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { useAppStore } from "../../stores/appStore";
import {
  listProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
} from "../../utils/ipc";
import type { Profile, ToolType } from "../../types";

const TOOL_OPTIONS: { value: ToolType; label: string; color: string }[] = [
  { value: "claude", label: "Claude Code", color: "blue" },
  { value: "codex", label: "Codex CLI", color: "green" },
  { value: "gemini", label: "Gemini CLI", color: "purple" },
  { value: "opencode", label: "OpenCode", color: "orange" },
];

const AUTH_OPTIONS = [
  { value: "api_key", label: "API Key" },
  { value: "oauth", label: "OAuth" },
];

const COLOR_PRESETS = [
  "#1677ff", "#52c41a", "#faad14", "#ff4d4f",
  "#722ed1", "#13c2c2", "#eb2f96", "#fa8c16",
];

export default function ProfileManagementPage() {
  const { message } = App.useApp();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form] = Form.useForm();
  const setStoreProfiles = useAppStore((s) => s.setProfiles);

  const loadProfiles = async () => {
    setLoading(true);
    try {
      const data = await listProfiles();
      setProfiles(data);
      setStoreProfiles(data);
    } catch {
      message.error("加载 Profile 失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfiles();
  }, []);

  const handleCreate = () => {
    setEditingId(null);
    form.resetFields();
    form.setFieldsValue({ color: COLOR_PRESETS[0], authType: "api_key" });
    setModalOpen(true);
  };

  const handleEdit = (profile: Profile) => {
    setEditingId(profile.id);
    form.setFieldsValue({
      name: profile.name,
      toolType: profile.toolType,
      authType: profile.authType,
      baseUrl: profile.baseUrl || "",
      appDataRoot: profile.appDataRoot || "",
      color: profile.color || COLOR_PRESETS[0],
      description: profile.description || "",
    });
    setModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteProfile(id, { removeData: false });
      message.success("删除成功");
      loadProfiles();
    } catch {
      message.error("删除失败");
    }
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      if (editingId) {
        await updateProfile(editingId, values);
        message.success("更新成功");
      } else {
        await createProfile({
          ...values,
          name: values.name,
          toolType: values.toolType,
          authType: values.authType,
          baseUrl: values.baseUrl || undefined,
          appDataRoot: values.appDataRoot || undefined,
          color: values.color || undefined,
          description: values.description || undefined,
        });
        message.success("创建成功");
      }
      setModalOpen(false);
      loadProfiles();
    } catch {
      message.error("保存失败");
    }
  };

  const columns = [
    {
      title: "名称",
      dataIndex: "name",
      key: "name",
      render: (text: string, record: Profile) => (
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-3 h-3 rounded-full"
            style={{ backgroundColor: record.color || "#888" }}
          />
          <span>{text}</span>
        </div>
      ),
    },
    {
      title: "工具",
      dataIndex: "toolType",
      key: "toolType",
      render: (type: ToolType) => {
        const opt = TOOL_OPTIONS.find((o) => o.value === type);
        return <Tag color={opt?.color}>{opt?.label || type}</Tag>;
      },
    },
    {
      title: "认证方式",
      dataIndex: "authType",
      key: "authType",
      render: (type: string) =>
        type === "api_key" ? <Tag>API Key</Tag> : <Tag>OAuth</Tag>,
    },
    {
      title: "描述",
      dataIndex: "description",
      key: "description",
      ellipsis: true,
    },
    {
      title: "操作",
      key: "action",
      render: (_: unknown, record: Profile) => (
        <Space size="small">
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确认删除"
            description="删除后无法恢复，是否继续？"
            onConfirm={() => handleDelete(record.id)}
            okText="删除"
            cancelText="取消"
          >
            <Button size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-6">
        <h4 className="text-lg font-medium m-0">Profile 管理</h4>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={loadProfiles}>
            刷新
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleCreate}
          >
            新建 Profile
          </Button>
        </Space>
      </div>

      <Card>
        <Table
          dataSource={profiles}
          columns={columns}
          rowKey="id"
          loading={loading}
          size="small"
          pagination={{ pageSize: 10 }}
        />
      </Card>

      <Modal
        title={editingId ? "编辑 Profile" : "新建 Profile"}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        okText={editingId ? "更新" : "创建"}
        cancelText="取消"
        width={520}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: "请输入名称" }]}
          >
            <Input placeholder="例如：Claude 默认" />
          </Form.Item>

          <Form.Item
            name="toolType"
            label="CLI 工具"
            rules={[{ required: true, message: "请选择工具" }]}
          >
            <Select placeholder="选择工具">
              {TOOL_OPTIONS.map((o) => (
                <Select.Option key={o.value} value={o.value}>
                  {o.label}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="authType"
            label="认证方式"
            rules={[{ required: true, message: "请选择认证方式" }]}
          >
            <Select placeholder="选择认证方式">
              {AUTH_OPTIONS.map((o) => (
                <Select.Option key={o.value} value={o.value}>
                  {o.label}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item name="baseUrl" label="Base URL">
            <Input placeholder="可选，自定义 API 地址" />
          </Form.Item>

          <Form.Item name="appDataRoot" label="数据目录">
            <Input placeholder="可选，自定义数据存储路径" />
          </Form.Item>

          <Form.Item name="color" label="颜色标记">
            <ColorPicker
              presets={[{ label: "预设", colors: COLOR_PRESETS }]}
            />
          </Form.Item>

          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="可选描述" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
