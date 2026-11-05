import { useEffect, useState } from "react";
import { Button, Card, Form, Input, Modal, Popconfirm, Space, Table, App } from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ScanOutlined,
} from "@ant-design/icons";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  devEnvironmentCreate,
  devEnvironmentDelete,
  devEnvironmentDetect,
  devEnvironmentUpdate,
} from "../../utils/ipc";
import { useAppStore } from "../../stores/appStore";
import type { DevEnvironment } from "../../types";

interface DevEnvironmentPageProps {
  kind: "java" | "node";
  /** 标题栏上的说明文案 */
  description: string;
}

interface EnvFormValues {
  name: string;
  jdkVersion?: string;
  jdkPath?: string;
  mavenVersion?: string;
  mavenPath?: string;
  nodeVersion?: string;
  nodePath?: string;
}

export default function DevEnvironmentPage({ kind, description }: DevEnvironmentPageProps) {
  const { message } = App.useApp();
  const devEnvironments = useAppStore((s) => s.devEnvironments);
  const loadDevEnvironments = useAppStore((s) => s.loadDevEnvironments);

  const [detecting, setDetecting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form] = Form.useForm<EnvFormValues>();

  const isJava = kind === "java";
  const title = isJava ? "Java 环境" : "Node 环境";

  const rows = devEnvironments.filter((e) => e.kind === kind);

  useEffect(() => {
    loadDevEnvironments().catch(() => message.error("加载开发环境失败"));
  }, []);

  const handleDetect = async () => {
    setDetecting(true);
    try {
      const result = await devEnvironmentDetect(kind);
      await loadDevEnvironments();
      if (result.created.length === 0) {
        message.info("没有发现新的环境");
      } else {
        message.success(`识别到 ${result.created.length} 个新环境`);
      }
    } catch (e) {
      message.error(`自动识别失败：${e}`);
    } finally {
      setDetecting(false);
    }
  };

  const handleCreate = () => {
    setEditingId(null);
    form.resetFields();
    setModalOpen(true);
  };

  const handleEdit = (record: DevEnvironment) => {
    setEditingId(record.id);
    form.setFieldsValue({
      name: record.name,
      jdkVersion: record.jdkVersion ?? "",
      jdkPath: record.jdkPath ?? "",
      mavenVersion: record.mavenVersion ?? "",
      mavenPath: record.mavenPath ?? "",
      nodeVersion: record.nodeVersion ?? "",
      nodePath: record.nodePath ?? "",
    });
    setModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await devEnvironmentDelete(id);
      await loadDevEnvironments();
      message.success("已删除");
    } catch (e) {
      message.error(`删除失败：${e}`);
    }
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const payload = {
        kind,
        name: values.name.trim(),
        jdkVersion: isJava ? values.jdkVersion?.trim() || undefined : undefined,
        jdkPath: isJava ? values.jdkPath?.trim() || undefined : undefined,
        mavenVersion: isJava ? values.mavenVersion?.trim() || undefined : undefined,
        mavenPath: isJava ? values.mavenPath?.trim() || undefined : undefined,
        nodeVersion: isJava ? undefined : values.nodeVersion?.trim() || undefined,
        nodePath: isJava ? undefined : values.nodePath?.trim() || undefined,
      };
      if (editingId) {
        await devEnvironmentUpdate(editingId, payload);
        message.success("已更新");
      } else {
        await devEnvironmentCreate(payload);
        message.success("已创建");
      }
      setModalOpen(false);
      await loadDevEnvironments();
    } catch (e) {
      if (e instanceof Error) {
        message.error(`保存失败：${e.message}`);
      }
    }
  };

  const browse = async (field: "jdkPath" | "mavenPath" | "nodePath") => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (selected && typeof selected === "string") {
      form.setFieldValue(field, selected);
    }
  };

  const columns = isJava
    ? [
        {
          title: "名称",
          dataIndex: "name",
          key: "name",
        },
        {
          title: "JDK",
          key: "jdk",
          render: (_: unknown, record: DevEnvironment) => (
            <div className="text-xs">
              <div>{record.jdkVersion || "未指定版本"}</div>
              <div className="text-[var(--ant-color-text-tertiary)] break-all">
                {record.jdkPath || "未指定路径"}
              </div>
            </div>
          ),
        },
        {
          title: "Maven",
          key: "maven",
          render: (_: unknown, record: DevEnvironment) => (
            <div className="text-xs">
              <div>{record.mavenVersion || "未指定版本"}</div>
              <div className="text-[var(--ant-color-text-tertiary)] break-all">
                {record.mavenPath || "未指定路径"}
              </div>
            </div>
          ),
        },
        {
          title: "操作",
          key: "action",
          width: 160,
          render: (_: unknown, record: DevEnvironment) => (
            <Space size="small">
              <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
                编辑
              </Button>
              <Popconfirm
                title="确认删除"
                description="删除后引用它的项目会退回默认环境，是否继续？"
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
      ]
    : [
        {
          title: "名称",
          dataIndex: "name",
          key: "name",
        },
        {
          title: "Node",
          key: "node",
          render: (_: unknown, record: DevEnvironment) => (
            <div className="text-xs">
              <div>{record.nodeVersion || "未指定版本"}</div>
              <div className="text-[var(--ant-color-text-tertiary)] break-all">
                {record.nodePath || "未指定路径"}
              </div>
            </div>
          ),
        },
        {
          title: "操作",
          key: "action",
          width: 160,
          render: (_: unknown, record: DevEnvironment) => (
            <Space size="small">
              <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
                编辑
              </Button>
              <Popconfirm
                title="确认删除"
                description="删除后引用它的项目会退回默认环境，是否继续？"
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
    <div className="p-6">
      <div className="flex items-center justify-between mb-1">
        <h4 className="text-lg font-medium m-0">{title}</h4>
        <Space>
          <Button icon={<ScanOutlined />} loading={detecting} onClick={handleDetect}>
            自动识别
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            新建
          </Button>
        </Space>
      </div>
      <p className="text-xs text-[var(--ant-color-text-secondary)] mt-0 mb-4">{description}</p>

      <Card>
        <Table
          dataSource={rows}
          columns={columns}
          rowKey="id"
          size="small"
          locale={{ emptyText: "还没有配置，先点「自动识别」或「新建」" }}
          pagination={false}
        />
      </Card>

      <Modal
        title={editingId ? `编辑${title}` : `新建${title}`}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        okText={editingId ? "更新" : "创建"}
        cancelText="取消"
        width={520}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: "请输入名称" }]}
          >
            <Input placeholder={isJava ? "例如：JDK 21 + Maven 3.9.11" : "例如：Node 22.13.1"} />
          </Form.Item>

          {isJava ? (
            <>
              <Form.Item name="jdkVersion" label="JDK 版本">
                <Input placeholder="例如：21.0.2" />
              </Form.Item>
              <Form.Item name="jdkPath" label="JDK 路径">
                <Input
                  placeholder="JDK 安装根目录，例如 /usr/lib/jvm/java-21"
                  addonAfter={
                    <span
                      className="cursor-pointer text-xs text-[var(--ant-color-primary)]"
                      onClick={() => browse("jdkPath")}
                    >
                      浏览
                    </span>
                  }
                />
              </Form.Item>
              <Form.Item name="mavenVersion" label="Maven 版本">
                <Input placeholder="例如：3.9.11" />
              </Form.Item>
              <Form.Item name="mavenPath" label="Maven 路径">
                <Input
                  placeholder="Maven 安装根目录，例如 /opt/maven"
                  addonAfter={
                    <span
                      className="cursor-pointer text-xs text-[var(--ant-color-primary)]"
                      onClick={() => browse("mavenPath")}
                    >
                      浏览
                    </span>
                  }
                />
              </Form.Item>
            </>
          ) : (
            <>
              <Form.Item name="nodeVersion" label="Node 版本">
                <Input placeholder="例如：22.13.1" />
              </Form.Item>
              <Form.Item name="nodePath" label="Node 路径">
                <Input
                  placeholder="Node 安装根目录，例如 ~/.nvm/versions/node/v22.13.1"
                  addonAfter={
                    <span
                      className="cursor-pointer text-xs text-[var(--ant-color-primary)]"
                      onClick={() => browse("nodePath")}
                    >
                      浏览
                    </span>
                  }
                />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </div>
  );
}
