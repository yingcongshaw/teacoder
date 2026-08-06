import { useState, useEffect } from "react";
import {
  Card,
  Statistic,
  Row,
  Col,
  Button,
  Table,
  Tag,
  Typography,
  DatePicker,
  message,
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { getGlobalCost, getProfileCost, scanCosts } from "../../utils/ipc";
import { useAppStore } from "../../stores/appStore";
import { TOOL_DISPLAY_NAMES } from "../../types";
import type { CostSummary } from "../../types";

const { RangePicker } = DatePicker;

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatCost(usd: number): string {
  if (usd >= 100) return `$${usd.toFixed(2)}`;
  if (usd >= 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(4)}`;
}

export default function CostDashboard() {
  const profiles = useAppStore((s) => s.profiles);
  const [globalCost, setGlobalCost] = useState<CostSummary | null>(null);
  const [profileCosts, setProfileCosts] = useState<Record<string, CostSummary>>({});
  const [scanning, setScanning] = useState(false);
  const [dateRange, setDateRange] = useState<[number, number] | null>(null);
  const [messageApi, contextHolder] = message.useMessage();

  const loadCosts = () => {
    const range = dateRange
      ? { from: dateRange[0], to: dateRange[1] }
      : undefined;

    getGlobalCost(range).then(setGlobalCost).catch(() => {});

    profiles.forEach((p) => {
      getProfileCost(p.id, range)
        .then((cost) => {
          setProfileCosts((prev) => ({ ...prev, [p.id]: cost }));
        })
        .catch(() => {});
    });
  };

  useEffect(() => {
    loadCosts();
  }, [profiles, dateRange]);

  const handleScan = async () => {
    setScanning(true);
    try {
      const count = await scanCosts();
      messageApi.success(`已扫描 ${count} 个 Claude Code 会话`);
      loadCosts();
    } catch {
      messageApi.error("扫描失败");
    } finally {
      setScanning(false);
    }
  };

  const profileTableData = profiles.map((p) => {
    const cost = profileCosts[p.id] || {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costUsd: 0,
    };
    return {
      key: p.id,
      name: p.name,
      toolType: p.toolType,
      ...cost,
    };
  });

  const columns = [
    {
      title: "Profile",
      dataIndex: "name",
      key: "name",
    },
    {
      title: "工具",
      dataIndex: "toolType",
      key: "toolType",
      render: (tt: string) => (
        <Tag>{TOOL_DISPLAY_NAMES[tt as keyof typeof TOOL_DISPLAY_NAMES] || tt}</Tag>
      ),
    },
    {
      title: "输入 Tokens",
      dataIndex: "inputTokens",
      key: "inputTokens",
      render: (v: number) => formatTokens(v),
    },
    {
      title: "输出 Tokens",
      dataIndex: "outputTokens",
      key: "outputTokens",
      render: (v: number) => formatTokens(v),
    },
    {
      title: "缓存创建",
      dataIndex: "cacheCreationTokens",
      key: "cacheCreationTokens",
      render: (v: number) => formatTokens(v),
    },
    {
      title: "缓存读取",
      dataIndex: "cacheReadTokens",
      key: "cacheReadTokens",
      render: (v: number) => formatTokens(v),
    },
    {
      title: "费用",
      dataIndex: "costUsd",
      key: "costUsd",
      render: (v: number) => (
        <Typography.Text strong>{formatCost(v)}</Typography.Text>
      ),
    },
  ];

  return (
    <div className="p-4 h-full overflow-y-auto">
      {contextHolder}
      <div className="flex items-center justify-between mb-4">
        <Typography.Title level={4} className="m-0">
          费用统计
        </Typography.Title>
        <div className="flex items-center gap-2">
          <RangePicker
            onChange={(_, ds) => {
              if (ds[0] && ds[1]) {
                setDateRange([
                  new Date(ds[0]).getTime(),
                  new Date(ds[1]).getTime(),
                ]);
              } else {
                setDateRange(null);
              }
            }}
          />
          <Button
            icon={<ReloadOutlined />}
            loading={scanning}
            onClick={handleScan}
          >
            扫描 Claude 数据
          </Button>
        </div>
      </div>

      <Row gutter={16} className="mb-4">
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="总费用"
              value={globalCost?.costUsd || 0}
              precision={4}
              prefix="$"
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="输入 Tokens"
              value={formatTokens(globalCost?.inputTokens || 0)}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="输出 Tokens"
              value={formatTokens(globalCost?.outputTokens || 0)}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="缓存 Tokens"
              value={formatTokens(
                (globalCost?.cacheCreationTokens || 0) +
                (globalCost?.cacheReadTokens || 0),
              )}
            />
          </Card>
        </Col>
      </Row>

      <Card title="各 Profile 费用明细" size="small">
        <Table
          dataSource={profileTableData}
          columns={columns}
          pagination={false}
          size="small"
          locale={{ emptyText: "暂无数据，点击「扫描 Claude 数据」从本地文件读取" }}
        />
      </Card>
    </div>
  );
}
