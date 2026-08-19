import { useState, useEffect } from "react";
import {
  Modal,
  Form,
  Input,
  Select,
  Typography,
  ColorPicker,
  App,
} from "antd";
import { useAppStore } from "../../stores/appStore";
import {
  createProfile,
  updateProfile,
  listProfiles,
  getProfileCredential,
} from "../../utils/ipc";
import { TOOL_DISPLAY_NAMES } from "../../types";
import type { ToolType, AuthType } from "../../types";

interface ProfileFormModalProps {
  open: boolean;
  editingId: string | null;
  onClose: () => void;
}

const COLOR_PRESETS = [
  "#1677ff", "#52c41a", "#faad14", "#ff4d4f",
  "#722ed1", "#13c2c2", "#eb2f96", "#fa8c16",
];

export default function ProfileFormModal({
  open,
  editingId,
  onClose,
}: ProfileFormModalProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const profiles = useAppStore((s) => s.profiles);
  const setProfiles = useAppStore((s) => s.setProfiles);
  const [selectedTool, setSelectedTool] = useState<ToolType | null>(null);
  const [selectedAuthType, setSelectedAuthType] = useState<AuthType>("api_key");
  const [loading, setLoading] = useState(false);
  const [credentialLoaded, setCredentialLoaded] = useState(false);

  const editingProfile = editingId
    ? profiles.find((p) => p.id === editingId)
    : null;

  useEffect(() => {
    if (open) {
      setCredentialLoaded(false);
      if (editingProfile) {
        form.setFieldsValue({
          name: editingProfile.name,
          toolType: editingProfile.toolType,
          authType: editingProfile.authType,
          baseUrl: editingProfile.baseUrl,
          appDataRoot: editingProfile.appDataRoot,
          color: editingProfile.color || COLOR_PRESETS[0],
          description: editingProfile.description,
          apiKey: "",
          oauthToken: "",
          oauthRefreshToken: "",
        });
        setSelectedTool(editingProfile.toolType);
        setSelectedAuthType(editingProfile.authType as AuthType);
      } else {
        form.resetFields();
        setSelectedTool(null);
        setSelectedAuthType("api_key");
      }
    }
  }, [open, editingProfile, form]);

  // Load masked credential for editing
  useEffect(() => {
    if (open && editingId && !credentialLoaded) {
      const keyName = selectedAuthType === "api_key" ? "api_key" : "oauth_token";
      getProfileCredential(editingId, keyName)
        .then((masked) => {
          if (masked) {
            if (selectedAuthType === "api_key") {
              form.setFieldValue("apiKey", masked);
            } else {
              form.setFieldValue("oauthToken", masked);
            }
          }
          setCredentialLoaded(true);
        })
        .catch(() => {
          setCredentialLoaded(true);
        });
    }
  }, [open, editingId, selectedAuthType, credentialLoaded, form]);

  const handleOk = async () => {
    try {
      const raw = await form.validateFields();
      setLoading(true);

      const values = {
        ...raw,
        color: raw.color && typeof raw.color === "object" && "toHexString" in raw.color
          ? (raw.color as { toHexString: () => string }).toHexString()
          : raw.color,
      };

      if (editingId) {
        await updateProfile(editingId, values);
      } else {
        await createProfile(values);
      }

      const updated = await listProfiles();
      setProfiles(updated);
      setLoading(false);
      onClose();
    } catch (err: unknown) {
      setLoading(false);
      if (err && typeof err === "object" && "errorFields" in err) {
        return; // form validation error, already shown
      }
      message.error(`操作失败: ${err}`);
    }
  };

  const envVarHint: Record<ToolType, string> = {
    claude: "将设置 CLAUDE_CONFIG_DIR 环境变量",
    codex: "将设置 CODEX_HOME 环境变量",
    gemini: "将设置 GEMINI_HOME 环境变量",
    antigravity: "将设置 ANTIGRAVITY_HOME 环境变量",
    opencode: "将设置 OPENCODE_HOME 环境变量",
    terminal: "不适用",
    ssh: "不适用",
  };

  const credentialPlaceholder: Record<ToolType, string> = {
    claude: "sk-ant-...",
    codex: "sk-...",
    gemini: "AIza...",
    antigravity: "输入 API Key",
    opencode: "输入 API Key",
    terminal: "不适用",
    ssh: "不适用",
  };

  return (
    <Modal
      title={editingId ? "编辑 Profile" : "新建 Profile"}
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      okText={editingId ? "保存" : "创建"}
      cancelText="取消"
      confirmLoading={loading}
      width={520}
      destroyOnHidden
      mask={{ closable: false }}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          authType: "api_key",
          color: COLOR_PRESETS[0],
        }}
      >
        <Form.Item
          name="name"
          label="名称"
          rules={[{ required: true, message: "请输入 Profile 名称" }]}
        >
          <Input placeholder="如：工作账号、个人项目" />
        </Form.Item>

        <Form.Item
          name="toolType"
          label="CLI 工具"
          rules={[{ required: true, message: "请选择 CLI 工具" }]}
        >
          <Select
            placeholder="选择 CLI 工具"
            onChange={(val: ToolType) => setSelectedTool(val)}
            disabled={!!editingId}
          >
            {Object.entries(TOOL_DISPLAY_NAMES).map(([key, name]) => (
              <Select.Option key={key} value={key}>
                {name}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item
          name="authType"
          label="认证方式"
          rules={[{ required: true }]}
        >
          <Select
            disabled={!!editingId}
            onChange={(val: AuthType) => setSelectedAuthType(val)}
          >
            <Select.Option value="api_key">API Key</Select.Option>
            <Select.Option value="oauth">OAuth</Select.Option>
          </Select>
        </Form.Item>

        {selectedAuthType === "api_key" ? (
          <Form.Item
            name="apiKey"
            label="API Key"
            extra={editingId ? "已存储的密钥以脱敏形式显示，留空则保留原值" : "密钥将存储在系统 Keychain 中，不会明文保存到数据库"}
          >
            <Input.Password
              placeholder={selectedTool ? credentialPlaceholder[selectedTool] : "输入 API Key"}
            />
          </Form.Item>
        ) : (
          <>
            <Form.Item
              name="oauthToken"
              label="OAuth Token"
              extra="Token 将存储在系统 Keychain 中"
            >
              <Input.Password placeholder="输入 OAuth Token" />
            </Form.Item>
            <Form.Item name="oauthRefreshToken" label="OAuth Refresh Token">
              <Input.Password placeholder="可选" />
            </Form.Item>
          </>
        )}

        <Form.Item name="baseUrl" label="自定义 API 地址">
          <Input placeholder="留空使用默认地址" />
        </Form.Item>

        <Form.Item
          name="appDataRoot"
          label={
            <span>
              数据隔离目录
              {selectedTool && (
                <Typography.Text type="secondary" className="ml-2 text-xs">
                  {envVarHint[selectedTool]}
                </Typography.Text>
              )}
            </span>
          }
        >
          <Input placeholder="留空使用默认路径，设置后该 Profile 的数据将独立存储" />
        </Form.Item>

        <Form.Item name="color" label="颜色标记">
          <ColorPicker presets={[{ label: "预设", colors: COLOR_PRESETS }]} />
        </Form.Item>

        <Form.Item name="description" label="备注">
          <Input.TextArea rows={2} placeholder="可选备注" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
