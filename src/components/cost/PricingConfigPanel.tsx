import { useState, useEffect } from "react";
import { Card, Table, Button, InputNumber, Typography, message, Space, Tag } from "antd";
import { EditOutlined, SaveOutlined, CloseOutlined } from "@ant-design/icons";
import { listPricing, updatePricing } from "../../utils/ipc";
import type { PricingConfig } from "../../types";

function formatPrice(v: number | null | undefined): string {
  if (v == null) return "--";
  if (v === 0) return "$0";
  if (v >= 0.01) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}

export default function PricingConfigPanel() {
  const [pricing, setPricing] = useState<PricingConfig[]>([]);
  const [editingModel, setEditingModel] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, number | null>>({});
  const [messageApi, contextHolder] = message.useMessage();

  const loadPricing = () => {
    listPricing()
      .then(setPricing)
      .catch(() => {});
  };

  useEffect(() => {
    loadPricing();
  }, []);

  const startEdit = (model: string) => {
    const row = pricing.find((p) => p.model === model);
    if (!row) return;
    setEditingModel(model);
    setEditValues({
      inputPrice: row.inputPrice,
      outputPrice: row.outputPrice,
      cacheCreationPrice: row.cacheCreationPrice,
      cacheReadPrice: row.cacheReadPrice,
    });
  };

  const cancelEdit = () => {
    setEditingModel(null);
    setEditValues({});
  };

  const saveEdit = async (model: string) => {
    try {
      await updatePricing(model, {
        inputPrice: editValues.inputPrice ?? undefined,
        outputPrice: editValues.outputPrice ?? undefined,
        cacheCreationPrice: editValues.cacheCreationPrice ?? undefined,
        cacheReadPrice: editValues.cacheReadPrice ?? undefined,
      });
      messageApi.success("单价已更新");
      setEditingModel(null);
      setEditValues({});
      loadPricing();
    } catch {
      messageApi.error("更新失败");
    }
  };

  const columns = [
    {
      title: "模型",
      dataIndex: "model",
      key: "model",
      render: (model: string, row: PricingConfig) => (
        <Space>
          <span>{model}</span>
          {row.isCustom && <Tag color="blue">自定义</Tag>}
        </Space>
      ),
    },
    {
      title: "输入单价 ($/1K tokens)",
      dataIndex: "inputPrice",
      key: "inputPrice",
      render: (v: number, row: PricingConfig) =>
        editingModel === row.model ? (
          <InputNumber
            size="small"
            min={0}
            step={0.01}
            value={editValues.inputPrice}
            onChange={(v) => setEditValues((prev) => ({ ...prev, inputPrice: v }))}
            style={{ width: 100 }}
          />
        ) : (
          formatPrice(v)
        ),
    },
    {
      title: "输出单价 ($/1K tokens)",
      dataIndex: "outputPrice",
      key: "outputPrice",
      render: (v: number, row: PricingConfig) =>
        editingModel === row.model ? (
          <InputNumber
            size="small"
            min={0}
            step={0.01}
            value={editValues.outputPrice}
            onChange={(v) => setEditValues((prev) => ({ ...prev, outputPrice: v }))}
            style={{ width: 100 }}
          />
        ) : (
          formatPrice(v)
        ),
    },
    {
      title: "缓存创建 ($/1K tokens)",
      dataIndex: "cacheCreationPrice",
      key: "cacheCreationPrice",
      render: (v: number, row: PricingConfig) =>
        editingModel === row.model ? (
          <InputNumber
            size="small"
            min={0}
            step={0.001}
            value={editValues.cacheCreationPrice}
            onChange={(v) => setEditValues((prev) => ({ ...prev, cacheCreationPrice: v }))}
            style={{ width: 100 }}
          />
        ) : (
          formatPrice(v)
        ),
    },
    {
      title: "缓存读取 ($/1K tokens)",
      dataIndex: "cacheReadPrice",
      key: "cacheReadPrice",
      render: (v: number, row: PricingConfig) =>
        editingModel === row.model ? (
          <InputNumber
            size="small"
            min={0}
            step={0.001}
            value={editValues.cacheReadPrice}
            onChange={(v) => setEditValues((prev) => ({ ...prev, cacheReadPrice: v }))}
            style={{ width: 100 }}
          />
        ) : (
          formatPrice(v)
        ),
    },
    {
      title: "操作",
      key: "action",
      render: (_: unknown, row: PricingConfig) =>
        editingModel === row.model ? (
          <Space>
            <Button
              size="small"
              type="primary"
              icon={<SaveOutlined />}
              onClick={() => saveEdit(row.model)}
            >
              保存
            </Button>
            <Button size="small" icon={<CloseOutlined />} onClick={cancelEdit}>
              取消
            </Button>
          </Space>
        ) : (
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => startEdit(row.model)}
          >
            编辑
          </Button>
        ),
    },
  ];

  return (
    <div className="p-4 h-full overflow-y-auto">
      {contextHolder}
      <div className="flex items-center justify-between mb-4">
        <Typography.Title level={4} className="m-0">
          模型单价配置
        </Typography.Title>
      </div>

      <Typography.Paragraph type="secondary" className="mb-4">
        单价单位为 USD / 1K tokens。修改后立即生效，影响后续费用计算。
      </Typography.Paragraph>

      <Card size="small">
        <Table
          dataSource={pricing}
          columns={columns}
          rowKey="model"
          pagination={false}
          size="small"
          locale={{ emptyText: "暂无定价数据，扫描会话后将自动填充" }}
        />
      </Card>
    </div>
  );
}
