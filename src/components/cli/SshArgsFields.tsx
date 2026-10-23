import { useState } from "react";
import { Button, Input } from "antd";
import type { SshArgs } from "../../types";

interface SshArgsFieldsProps {
  value: SshArgs;
  onChange: (next: SshArgs) => void;
  /** 测试连接需要走 IPC；不需要的宿主（如纯展示的弹窗）传 false 即可隐藏按钮。 */
  onTest?: () => void;
  testing?: boolean;
}

const FIELD_STYLE = {
  backgroundColor: "var(--ant-color-bg-elevated)",
  borderColor: "var(--ant-color-border)",
  color: "var(--ant-color-text)",
};

/** SSH 连接参数字段组。三个宿主（新建/编辑会话、临时连接弹窗）共用。
 *
 * 只拥有输入框与测试按钮，不拥有外层 section 的边框与标题 —— 三个宿主的容器
 * 样式各不相同，交给各自处理。
 */
export function SshArgsFields({ value, onChange, onTest, testing }: SshArgsFieldsProps) {
  const [passwordVisible, setPasswordVisible] = useState(false);
  const patch = (part: Partial<SshArgs>) => onChange({ ...value, ...part });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 items-center">
        <Input
          size="small"
          placeholder="主机名 *"
          value={value.hostname}
          onChange={(e) => patch({ hostname: e.target.value })}
          style={{ ...FIELD_STYLE, flex: 2 }}
        />
        <Input
          size="small"
          placeholder="端口"
          type="number"
          value={value.port}
          onChange={(e) => patch({ port: parseInt(e.target.value, 10) || 22 })}
          style={{ ...FIELD_STYLE, flex: 1 }}
        />
      </div>
      <Input
        size="small"
        placeholder="用户名（默认为 root）"
        value={value.username}
        onChange={(e) => patch({ username: e.target.value })}
        style={FIELD_STYLE}
      />
      <Input.Password
        size="small"
        placeholder="密码（PublicKey 优先）"
        value={value.password}
        onChange={(e) => patch({ password: e.target.value })}
        visibilityToggle={{
          visible: passwordVisible,
          onVisibleChange: setPasswordVisible,
        }}
        style={FIELD_STYLE}
      />
      <Input
        size="small"
        placeholder="PublicKey 路径（如 ~/.ssh/id_rsa）"
        value={value.identityFile}
        onChange={(e) => patch({ identityFile: e.target.value })}
        style={FIELD_STYLE}
      />
      {onTest && (
        <div className="flex justify-end">
          <Button size="small" onClick={onTest} loading={testing}>
            测试连接
          </Button>
        </div>
      )}
    </div>
  );
}

export default SshArgsFields;