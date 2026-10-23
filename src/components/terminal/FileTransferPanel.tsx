import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Alert, Button, Input, Progress, Segmented, Spin, Tooltip } from "antd";
import {
  CloudUploadOutlined,
  CloudDownloadOutlined,
  CloseOutlined,
  FolderOpenOutlined,
  SnippetsOutlined,
} from "@ant-design/icons";
import {
  openPathInFileManager,
  sshDownload,
  sshProbeRemoteCwd,
  sshTransferCancel,
  sshUpload,
  writeToPty,
} from "../../utils/ipc";
import { shellQuote, formatBytes } from "../../utils/shellQuote";
import SshConnectionModal from "./SshConnectionModal";
import type { SshArgs, SshTarget, TransferProgress, TransferSummary } from "../../types";

interface FileTransferPanelProps {
  tabId: string;
  toolType: string;
  /** 下载默认落点（项目目录）。无项目时为 null。 */
  workDir?: string | null;
  /**
   * 面板的 portal 宿主（终端根容器）。必须以它为包含块，
   * 否则百分比 max-height 会按按钮包装 div 的高度解析。
   */
  panelHostRef: React.RefObject<HTMLElement | null>;
}

type Mode = "upload" | "download";
type Phase = "idle" | "running" | "done" | "error";

interface ResultState {
  ok: boolean;
  text: string;
  files: string[];
  usedFallback: boolean;
  /** 结束态允许「在文件管理器中打开」，只对下载有意义 */
  openDir?: string;
}

const PANEL_STYLE = {
  width: 460,
  background: "var(--ant-color-bg-elevated)",
  border: "1px solid var(--ant-color-border-secondary)",
  borderRadius: 8,
  boxShadow: "0 6px 24px rgba(0,0,0,0.28)",
  overflow: "hidden",
} as const;

export default function FileTransferPanel({
  tabId,
  toolType,
  workDir,
  panelHostRef,
}: FileTransferPanelProps) {
  const supported = toolType === "ssh" || toolType === "terminal";
  const isSsh = toolType === "ssh";

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("upload");
  const [phase, setPhase] = useState<Phase>("idle");
  const [connModalOpen, setConnModalOpen] = useState(false);

  /** Terminal 会话没有远程信息，只能手填一次；填完存到 state，不落库。 */
  const [manualArgs, setManualArgs] = useState<SshArgs | null>(null);

  const [remoteDir, setRemoteDir] = useState("~/");
  const [remoteFile, setRemoteFile] = useState("");
  const [uploadPaths, setUploadPaths] = useState<string[]>([]);
  const [downloadDir, setDownloadDir] = useState("");
  const [result, setResult] = useState<ResultState | null>(null);
  const [progress, setProgress] = useState<TransferProgress | null>(null);

  const transferIdRef = useRef<string | null>(null);
  /**
   * Terminal 会话点上传/下载时若还没连接参数，会先弹窗再回来执行。
   * 存的是「拿到参数后要跑的传输」，参数由弹窗现给 —— 不能在点击时就绑定
   * manualArgs，那时它还是 null。用 ref 而非 state：弹窗关闭回调里要同步接着跑，
   * 等一次重渲染会把顺序搞乱。
   */
  const pendingRef = useRef<((args: SshArgs) => void) | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (downloadDir === "" && workDir) setDownloadDir(workDir);
  }, [workDir, downloadDir]);

  useEffect(() => {
    let disposed = false;
    let dispose: (() => void) | undefined;
    const unlisten = listen<TransferProgress>("ssh_transfer:progress", (event) => {
      if (event.payload.tabId !== tabId) return;
      // 进度事件顺带带回 transferId —— 命令本身只在结束时返回它，
      // 没有这条事件取消就无从下手。
      transferIdRef.current = event.payload.transferId;
      setProgress(event.payload);
    });
    void unlisten.then(
      (fn) => {
        // 卸载可能早于注册完成，此时立即退订，否则监听会一直挂着
        if (disposed) fn();
        else dispose = fn;
      },
      () => {
        // 监听注册失败不该拖垮面板，进度只是锦上添花
      },
    );
    return () => {
      disposed = true;
      dispose?.();
    };
  }, [tabId]);

  // 打开面板时探测远程 cwd。探测失败不是错误 —— 回落 ~/，输入框一直可改。
  useEffect(() => {
    if (!open || !isSsh) return;
    let cancelled = false;
    void (async () => {
      try {
        const cwd = await sshProbeRemoteCwd(tabId);
        if (!cancelled) setRemoteDir(cwd);
      } catch {
        if (!cancelled) setRemoteDir("~/");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, isSsh, tabId]);

  // 点击按钮或面板之外的任何位置都收起面板。pointerdown 早于 click，
  // 打开面板的那一次点击不会落到这里（此时 open 还是 false）。
  // 按钮与面板分属两个容器（面板经 portal 挂在终端根节点下），必须分别判断。
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (buttonRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const targetFrom = (args: SshArgs): SshTarget => ({
    kind: "manual",
    hostname: args.hostname,
    port: args.port,
    username: args.username || undefined,
    password: args.password || undefined,
    identityFile: args.identityFile || undefined,
  });

  const run = useCallback(async (fn: () => Promise<TransferSummary>, openDir?: string) => {
    setPhase("running");
    setResult(null);
    setProgress(null);
    transferIdRef.current = null;
    try {
      const summary = await fn();
      setPhase("done");
      setProgress(null);
      transferIdRef.current = null;
      setResult({
        ok: true,
        text:
          summary.direction === "upload"
            ? `已上传 ${summary.files.length} 个文件`
            : `已下载 ${summary.files.length} 个文件`,
        files: summary.files.map((f) => f.destination),
        usedFallback: summary.usedFallback,
        openDir,
      });
    } catch (e) {
      setPhase("error");
      setProgress(null);
      transferIdRef.current = null;
      setResult({
        ok: false,
        text: typeof e === "string" ? e : "传输失败",
        files: [],
        usedFallback: false,
      });
    }
  }, []);

  const reject = useCallback((text: string) => {
    setPhase("error");
    setResult({ ok: false, text, files: [], usedFallback: false });
  }, []);

  // 这两个只认「已经解析好的 target」。解析靠不上时（Terminal 会话缺参数），
  // 弹窗回来后用新参数重新调它们 —— 直接复用点击时的闭包会拿着 manualArgs === null
  // 的旧值再弹一次窗，死循环。
  const uploadWith = useCallback(
    async (target: SshTarget) => {
      if (uploadPaths.length === 0) return reject("请先选择要上传的文件");
      const dir = remoteDir.trim();
      if (!dir) return reject("请填写远程目录");
      await run(() => sshUpload({ target, tabId, localPaths: uploadPaths, remotePath: dir }));
    },
    [uploadPaths, remoteDir, reject, run, tabId],
  );

  const downloadWith = useCallback(
    async (target: SshTarget) => {
      const remote = remoteFile.trim();
      if (!remote) return reject("请填写远程文件路径");
      const dir = downloadDir.trim();
      if (!dir) return reject("请选择下载目录");
      await run(() => sshDownload({ target, tabId, remotePath: remote, localDir: dir }), dir);
    },
    [remoteFile, downloadDir, reject, run, tabId],
  );

  /** 解析 target；Terminal 会话还没参数时先弹窗，参数回来后由 pendingRef 接上。 */
  const withTarget = (act: (target: SshTarget) => void) => () => {
    if (isSsh) return void act({ kind: "fromSession", sessionId: tabId });
    if (manualArgs) return void act(targetFrom(manualArgs));
    pendingRef.current = (args) => act(targetFrom(args));
    setConnModalOpen(true);
  };

  const handlePickFiles = async () => {
    const picked = await openDialog({ multiple: true, directory: false });
    if (!picked) return;
    setUploadPaths(Array.isArray(picked) ? picked : [picked]);
  };

  const handlePickDownloadDir = async () => {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === "string") setDownloadDir(picked);
  };

  const handleCancel = async () => {
    const id = transferIdRef.current;
    if (!id) return;
    await sshTransferCancel(id).catch(() => {});
  };

  /** Terminal 会话的本地路径插入：裸写 PTY，不带回车。
   *
   * 用户多半是要把它作为正在输入的命令的参数，自动回车等于替他执行了。
   */
  const handleInsertPath = async () => {
    const picked = await openDialog({ directory: false, multiple: false });
    if (typeof picked !== "string") return;
    await writeToPty(tabId, `${shellQuote(picked)} `);
  };

  if (!supported) return null;

  const running = phase === "running";
  const percent =
    progress && progress.totalBytes && progress.totalBytes > 0
      ? Math.min(100, Math.round((progress.bytes / progress.totalBytes) * 100))
      : null;

  return (
    <>
      <Tooltip title={isSsh ? "文件传输" : "插入本地路径 / 传文件"} placement="left">
        <button
          ref={buttonRef}
          onClick={() => {
            setOpen((v) => !v);
            setResult(null);
          }}
          className="flex items-center justify-center rounded-full transition-all"
          style={{
            width: 32,
            height: 32,
            backgroundColor: open
              ? "var(--ant-color-primary)"
              : "var(--ant-color-bg-elevated)",
            border: "1px solid var(--ant-color-border-secondary)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            cursor: "pointer",
            color: open ? "#fff" : "var(--ant-color-text-secondary)",
          }}
        >
          {isSsh ? <CloudUploadOutlined style={{ fontSize: 14 }} /> : <SnippetsOutlined style={{ fontSize: 14 }} />}
        </button>
      </Tooltip>

      <SshConnectionModal
        open={connModalOpen}
        onClose={() => setConnModalOpen(false)}
        onConfirm={(args) => {
          setManualArgs(args);
          const pending = pendingRef.current;
          pendingRef.current = null;
          pending?.(args);
        }}
      />

      {open &&
        panelHostRef.current &&
        createPortal(
          <div
            ref={panelRef}
            className="absolute bottom-10 right-10 z-20 flex flex-col"
            style={PANEL_STYLE}
          >
            <div
              className="flex items-center gap-2 px-3 py-2"
              style={{ borderBottom: "1px solid var(--ant-color-border-secondary)" }}
            >
              <span className="text-sm font-medium flex-1">文件传输</span>
              <button
                onClick={() => setOpen(false)}
                aria-label="关闭"
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--ant-color-text-secondary)",
                  padding: 2,
                }}
              >
                <CloseOutlined style={{ fontSize: 13 }} />
              </button>
            </div>

            {!isSsh && (
              <div className="px-3 py-2 flex flex-col gap-2">
                <Button
                  size="small"
                  icon={<SnippetsOutlined />}
                  onClick={() => void handleInsertPath()}
                >
                  插入本地路径到终端
                </Button>
                <Alert
                  type="info"
                  showIcon
                  message={
                    manualArgs
                      ? `将传到 ${manualArgs.username || "当前用户"}@${manualArgs.hostname}`
                      : "本地终端会话没有远程信息，传文件需先填写连接参数"
                  }
                  action={
                    manualArgs ? (
                      <Button size="small" onClick={() => setConnModalOpen(true)}>
                        更换
                      </Button>
                    ) : (
                      <Button size="small" onClick={() => setConnModalOpen(true)}>
                        填写
                      </Button>
                    )
                  }
                />
              </div>
            )}

            {isSsh && (
              <div className="px-3 pt-2">
                <Segmented
                  size="small"
                  value={mode}
                  onChange={(v) => {
                    setMode(v as Mode);
                    setResult(null);
                  }}
                  options={[
                    {
                      value: "upload",
                      label: (
                        <span>
                          <CloudUploadOutlined /> 上传
                        </span>
                      ),
                    },
                    {
                      value: "download",
                      label: (
                        <span>
                          <CloudDownloadOutlined /> 下载
                        </span>
                      ),
                    },
                  ]}
                />
              </div>
            )}

            <div className="flex flex-col gap-2 px-3 py-2">
              {mode === "upload" ? (
                <>
                  <Input
                    size="small"
                    aria-label="远程目录"
                    value={remoteDir}
                    onChange={(e) => setRemoteDir(e.target.value)}
                    placeholder="远程目录，如 ~/ 或 /var/log"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="small"
                      icon={<SnippetsOutlined />}
                      disabled={running}
                      onClick={() => void handlePickFiles()}
                    >
                      选择文件
                    </Button>
                    <Button
                      size="small"
                      icon={<CloudUploadOutlined />}
                      disabled={running || uploadPaths.length === 0}
                      loading={running}
                      onClick={withTarget((t) => void uploadWith(t))}
                    >
                      上传
                    </Button>
                  </div>
                  {uploadPaths.length > 0 ? (
                    <ul className="text-xs text-[var(--ant-color-text-secondary)] max-h-24 overflow-y-auto">
                      {uploadPaths.map((p) => (
                        <li key={p} className="truncate">
                          {p}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-xs text-[var(--ant-color-text-tertiary)]">
                      尚未选择文件
                    </span>
                  )}
                </>
              ) : (
                <>
                  <Input
                    size="small"
                    aria-label="远程文件路径"
                    value={remoteFile}
                    onChange={(e) => setRemoteFile(e.target.value)}
                    placeholder="远程文件完整路径，如 /var/log/syslog"
                    onPressEnter={withTarget((t) => void downloadWith(t))}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="small"
                      icon={<CloudDownloadOutlined />}
                      disabled={running}
                      loading={running}
                      onClick={withTarget((t) => void downloadWith(t))}
                    >
                      下载
                    </Button>
                    <Button
                      size="small"
                      icon={<FolderOpenOutlined />}
                      disabled={running}
                      onClick={() => void handlePickDownloadDir()}
                    >
                      换目录
                    </Button>
                  </div>
                  <span className="text-xs text-[var(--ant-color-text-tertiary)] truncate">
                    落到：{downloadDir || "（未选择）"}
                  </span>
                </>
              )}
            </div>

            {running && (
              <div className="px-3 pb-2">
                {percent !== null ? (
                  <Progress
                    size="small"
                    percent={percent}
                    format={() =>
                      `${formatBytes(progress?.bytes ?? 0)} / ${formatBytes(
                        progress?.totalBytes ?? 0,
                      )}`
                    }
                  />
                ) : (
                  // 下载拿不到远程文件大小（要另开一条连接才问得到），不编造百分比
                  <div className="flex items-center gap-2 text-xs text-[var(--ant-color-text-secondary)]">
                    <Spin size="small" />
                    传输中 · 已收 {formatBytes(progress?.bytes ?? 0)}
                  </div>
                )}
                <div className="flex items-center justify-end mt-1">
                  <Button size="small" danger onClick={() => void handleCancel()}>
                    取消
                  </Button>
                </div>
              </div>
            )}

            {result && (
              <div className="px-3 pb-2">
                <Alert
                  type={result.ok ? "success" : "error"}
                  showIcon
                  message={result.text}
                  description={
                    <div className="text-xs">
                      {result.files.map((f) => (
                        <div key={f} className="truncate">
                          {f}
                        </div>
                      ))}
                      {result.usedFallback && (
                        <div style={{ color: "var(--ant-color-warning)" }}>
                          远程主机不支持 SFTP 子系统，已回退旧版 SCP。
                        </div>
                      )}
                    </div>
                  }
                />
                {result.openDir && (
                  <Button
                    size="small"
                    icon={<FolderOpenOutlined />}
                    onClick={() => void openPathInFileManager(result.openDir as string)}
                    style={{ marginTop: 6 }}
                  >
                    在文件管理器中打开
                  </Button>
                )}
              </div>
            )}

            <div
              className="text-xs px-3 py-1"
              style={{ borderTop: "1px solid var(--ant-color-border-secondary)" }}
            >
              <span className="text-[var(--ant-color-text-tertiary)]">
                下载重名自动加序号，不覆盖已有文件
              </span>
            </div>
          </div>,
          panelHostRef.current,
        )}
    </>
  );
}