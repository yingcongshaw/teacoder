import { useEffect, useMemo, useState } from "react";
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
import type { DevEnvironment, DevEnvKind, DevTool } from "../../types";
import { DEV_KIND_CONFIGS, type DevKindConfig } from "../../utils/devEnvKinds";

interface DevEnvironmentPageProps {
  kind: DevEnvKind;
}

interface ToolDraft {
  version: string;
  path: string;
}

export default function DevEnvironmentPage({ kind }: DevEnvironmentPageProps) {
  const { message } = App.useApp();
  const devEnvironments = useAppStore((s) => s.devEnvironments);
  const loadDevEnvironments = useAppStore((s) => s.loadDevEnvironments);

  const [detecting, setDetecting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [drafts, setDrafts] = useState<Record<string, ToolDraft>>({});

  const config = useMemo<DevKindConfig>(
    () => DEV_KIND_CONFIGS.find((c) => c.kind === kind)!,
    [kind],
  );

  const rows = devEnvironments.filter((e) => e.kind === kind);

  useEffect(() => {
    loadDevEnvironments().catch(() => message.error("加载开发环境失败"));
  }, []);

  const emptyDrafts = (): Record<string, ToolDraft> => {
    const next: Record<string, ToolDraft> = {};
    for (const tool of config.tools) {
      next[tool.tool] = { version: "", path: "" };
    }
    return next;
  };

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
    setName("");
    setDrafts(emptyDrafts());
    setModalOpen(true);
  };

  const handleEdit = (record: DevEnvironment) => {
    setEditingId(record.id);
    setName(record.name);
    const next = emptyDrafts();
    for (const tool of config.tools) {
      const found = record.tools.find((t) => t.tool === tool.tool);
      next[tool.tool] = {
        version: found?.version ?? "",
        path: found?.path ?? "",
      };
    }
    setDrafts(next);
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
    const trimmedName = name.trim();
    if (!trimmedName) {
      message.error("请输入名称");
      return;
    }

    // 填了路径才算这件工具，版本可有可无
    const tools: DevTool[] = config.tools
      .filter((tool) => (drafts[tool.tool]?.path ?? "").trim())
      .map((tool) => ({
        tool: tool.tool,
        version: drafts[tool.tool]?.version.trim() || undefined,
        path: drafts[tool.tool]?.path.trim(),
      }));

    try {
      const payload = { kind, name: trimmedName, tools };
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

  const browse = async (tool: string, pathType: "dir" | "file") => {
    const selected = await openDialog(
      pathType === "dir"
        ? { directory: true, multiple: false }
        : { directory: false, multiple: false },
    );
    if (selected && typeof selected === "string") {
      setDrafts((prev) => ({ ...prev, [tool]: { ...prev[tool], path: selected } }));
    }
  };

  const columns = [
    {
      title: "名称",
      dataIndex: "name",
      key: "name",
    },
    ...config.tools.map((tool) => ({
      title: tool.label,
      key: tool.tool,
      render: (_: unknown, record: DevEnvironment) => {
        const found = record.tools.find((t) => t.tool === tool.tool);
        return (
          <div className="text-xs">
            <div>{found?.version || "未指定版本"}</div>
            <div className="text-[var(--ant-color-text-tertiary)] break-all">
              {found?.path || "未指定路径"}
            </div>
          </div>
        );
      },
    })),
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
        <h4 className="text-lg font-medium m-0">{config.title}</h4>
        <Space>
          <Button icon={<ScanOutlined />} loading={detecting} onClick={handleDetect}>
            自动识别
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            新建
          </Button>
        </Space>
      </div>
      <p className="text-xs text-[var(--ant-color-text-secondary)] mt-0 mb-4">
        {config.description}
      </p>

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
        title={editingId ? `编辑${config.title}` : `新建${config.title}`}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        okText={editingId ? "更新" : "创建"}
        cancelText="取消"
        width={520}
        destroyOnHidden
      >
        <Form layout="vertical">
          <Form.Item label="名称" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`例如：${config.title.replace(" 环境", "")} 21.0.2`}
            />
          </Form.Item>

          {config.tools.map((tool) => (
            <Form.Item key={tool.tool} label={`${tool.label} 版本`}>
              <Input
                value={drafts[tool.tool]?.version ?? ""}
                onChange={(e) =>
                  setDrafts((prev) => ({
                    ...prev,
                    [tool.tool]: { ...prev[tool.tool], version: e.target.value },
                  }))
                }
                placeholder={tool.versionPlaceholder}
              />
            </Form.Item>
          ))}

          {config.tools.map((tool) => (
            <Form.Item key={`${tool.tool}-path`} label={`${tool.label} 路径`}>
              <Input
                value={drafts[tool.tool]?.path ?? ""}
                onChange={(e) =>
                  setDrafts((prev) => ({
                    ...prev,
                    [tool.tool]: { ...prev[tool.tool], path: e.target.value },
                  }))
                }
                placeholder={tool.pathPlaceholder}
                addonAfter={
                  <span
                    className="cursor-pointer text-xs text-[var(--ant-color-primary)]"
                    onClick={() => browse(tool.tool, tool.pathType)}
                  >
                    浏览
                  </span>
                }
              />
            </Form.Item>
          ))}
        </Form>
      </Modal>
    </div>
  );
}
