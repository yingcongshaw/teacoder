import { Button, Modal, Typography } from "antd";
import { GithubOutlined } from "@ant-design/icons";
import { MarkdownBody } from "../transcript/MarkdownBody";
import { openExternal } from "../../utils/openExternal";
import type { GithubRelease } from "../../utils/updateCheck";

/** 空关键词数组必须是模块级常量：react-markdown 按数组引用判断是否重跑流水线 */
const NO_TOKENS: readonly string[] = [];

interface UpdateNotificationModalProps {
  release: GithubRelease | null;
  onClose: () => void;
}

/**
 * 启动时检测到新版本后的提示弹窗。
 *
 * 更新说明来自 GitHub Release 的正文，按 Markdown 渲染。
 */
export default function UpdateNotificationModal({
  release,
  onClose,
}: UpdateNotificationModalProps) {
  if (!release) return null;

  const published = release.publishedAt
    ? new Date(release.publishedAt).toLocaleDateString("zh-CN")
    : "";

  return (
    <Modal
      open
      onCancel={onClose}
      width={560}
      title={
        <span>
          <GithubOutlined style={{ marginRight: 8 }} />
          发现新版本 {release.tagName}
        </span>
      }
      footer={[
        <Button key="later" onClick={onClose}>
          稍后
        </Button>,
        <Button
          key="download"
          type="primary"
          icon={<GithubOutlined />}
          onClick={() => {
            void openExternal(release.htmlUrl);
          }}
        >
          前往下载
        </Button>,
      ]}
    >
      {published && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          发布于 {published}
        </Typography.Text>
      )}
      <div style={{ maxHeight: 360, overflowY: "auto", marginTop: 12 }}>
        <MarkdownBody text={release.body || release.name} tokens={NO_TOKENS} />
      </div>
    </Modal>
  );
}
