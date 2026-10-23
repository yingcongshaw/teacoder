import { useState } from "react";
import { Modal } from "antd";
import { SshArgsFields } from "../cli/SshArgsFields";
import { EMPTY_SSH_ARGS } from "../../utils/sshArgs";
import { testSshConnection } from "../../utils/ipc";
import type { SshArgs } from "../../types";

interface SshConnectionModalProps {
  open: boolean;
  onClose: () => void;
  /** 确认后把参数交给调用方。调用方只在本次传输内存放，不落库。 */
  onConfirm: (args: SshArgs) => void;
}

/**
 * Terminal 会话临时填写 SSH 连接参数。
 *
 * 存在的理由是 Terminal 的 PTY 是本地 shell —— 用户完全可能自己敲了
 * `ssh user@host` 登上去，此时会话本身没有任何远程信息可解析，只能手填。
 *
 * 密码只活在本组件的 state 里，关窗即清（见 close）；调用方拿到一份副本
 * 留在面板 state 上，方便连续传多个文件。两者都不落库、不打日志。
 */
export default function SshConnectionModal({ open, onClose, onConfirm }: SshConnectionModalProps) {
  const [args, setArgs] = useState<SshArgs>(EMPTY_SSH_ARGS);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  const close = () => {
    // 连同密码一起清掉：state 残留等于凭据在内存里多活一个弹窗周期
    setArgs(EMPTY_SSH_ARGS);
    setTestResult(null);
    onClose();
  };

  const handleTest = async () => {
    if (!args.hostname.trim()) {
      setTestResult({ ok: false, text: "请填写主机名" });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const msg = await testSshConnection({
        hostname: args.hostname.trim(),
        port: args.port,
        username: args.username.trim() || undefined,
        password: args.password || undefined,
        identity_file: args.identityFile.trim() || undefined,
      });
      setTestResult({ ok: true, text: msg });
    } catch (e) {
      setTestResult({ ok: false, text: typeof e === "string" ? e : "连接失败" });
    } finally {
      setTesting(false);
    }
  };

  const handleConfirm = () => {
    if (!args.hostname.trim()) {
      setTestResult({ ok: false, text: "请填写主机名" });
      return;
    }
    onConfirm({
      ...args,
      hostname: args.hostname.trim(),
      username: args.username.trim(),
      identityFile: args.identityFile.trim(),
    });
    close();
  };

  return (
    <Modal
      open={open}
      onCancel={close}
      onOk={handleConfirm}
      okText="开始传输"
      cancelText="取消"
      width={420}
      destroyOnHidden
      title="输入 SSH 连接参数"
    >
      <p className="text-xs text-[var(--ant-color-text-secondary)] mb-3">
        本次会话是本地终端，不会从会话里取到远程连接信息，因此需要手动填写。
        密码和私钥都留空时，走 SSH Agent 或默认密钥。
      </p>

      <SshArgsFields value={args} onChange={setArgs} onTest={handleTest} testing={testing} />

      {testResult && (
        <div
          className="text-xs mt-2"
          style={{
            color: testResult.ok
              ? "var(--ant-color-success)"
              : "var(--ant-color-error)",
          }}
        >
          {testResult.text}
        </div>
      )}
    </Modal>
  );
}