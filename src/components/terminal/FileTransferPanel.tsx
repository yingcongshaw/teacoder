import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button, Empty, Input, Progress, Table, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  CloseOutlined,
  CloudDownloadOutlined,
  CloudUploadOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  FileOutlined,
  FolderOutlined,
  FolderOpenOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  SnippetsOutlined,
  StopOutlined,
} from "@ant-design/icons";
import {
  fsListDir,
  sshDownload,
  sshListDir,
  sshProbeRemoteCwd,
  sshTransferCancel,
  sshUpload,
  writeToPty,
} from "../../utils/ipc";
import { formatBytes, shellQuote } from "../../utils/shellQuote";
import SshConnectionModal from "./SshConnectionModal";
import type {
  DirEntry,
  SshArgs,
  SshTarget,
  TransferProgress,
} from "../../types";

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

type Direction = "upload" | "download";
type RowState = "running" | "done" | "error";

/** 同步日志里的一行 —— 对应一次文件传输。 */
interface LogRow {
  /** 前端生成的请求标识，进度事件靠它对上这一行。 */
  requestId: string;
  direction: Direction;
  name: string;
  size: number;
  startedAt: number;
  bytes: number;
  /** 后端给的总量；下载方向为 null，改用列表里看到的文件大小。 */
  totalBytes: number | null;
  /** 后端的传输 id，取消时用。首个进度事件带来。 */
  transferId?: string;
  state: RowState;
  error?: string;
}

/**
 * 日志表的紧凑渲染。
 *
 * 用 AntD Table 的 `components` 覆盖行/单元格，而不是写 CSS：
 * AntD 6 的表格样式是运行时注入的 CSS-in-JS，注入时机在 index.css 之后，
 * 同特异性下它赢 —— 外部 CSS 压不住它的单元格 padding。行内样式优先级最高，
 * 不受影响。
 */
const COMPACT_TABLE = {
  header: {
    row: (props: React.HTMLAttributes<HTMLTableRowElement>) => (
      <tr {...props} style={{ ...props.style, height: 18 }} />
    ),
    cell: (props: React.ThHTMLAttributes<HTMLTableCellElement>) => (
      <th
        {...props}
        style={{
          ...props.style,
          padding: "0 8px",
          height: 18,
          lineHeight: "18px",
          textAlign: "center",
        }}
      />
    ),
  },
  body: {
    row: (props: React.HTMLAttributes<HTMLTableRowElement>) => {
      // AntD 插的测量行不占位，别给它 18px 行高
      const hidden = (props as { "aria-hidden"?: string })["aria-hidden"] === "true";
      return <tr {...props} style={{ ...props.style, height: hidden ? 0 : 18 }} />;
    },
    cell: (props: React.TdHTMLAttributes<HTMLTableCellElement>) => (
      <td
        {...props}
        style={{
          ...props.style,
          padding: "0 8px",
          height: 18,
          lineHeight: "18px",
        }}
      />
    ),
  },
};

/** 头部几个图标按钮的统一样式。去掉 outline：点过之后 WebKit 会留下一个
 *  聚焦框，看着像按钮自带边框。 */
const ICON_BTN_STYLE = {
  background: "transparent",
  border: "none",
  cursor: "pointer",
  color: "var(--ant-color-text-secondary)",
  padding: 2,
  outline: "none",
} as const;

const PANEL_STYLE = {
  width: 760,
  // 跟随终端区域高度：写死数值会在矮终端里被裁掉顶部
  maxHeight: "calc(100% - 2.5rem)",
  background: "var(--ant-color-bg-elevated)",
  border: "1px solid var(--ant-color-border-secondary)",
  borderRadius: 8,
  boxShadow: "0 6px 24px rgba(0,0,0,0.28)",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
} as const;

/** 路径的上一级。`/root/a` → `/root`；`/` 仍是 `/`。 */
function parentPath(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  if (trimmed === "" || trimmed === "/") return "/";
  const idx = trimmed.lastIndexOf("/");
  if (idx <= 0) return "/";
  return trimmed.slice(0, idx);
}

/** `YYYY/MM/DD`。 */
function formatDate(unixSec: number | null): string {
  if (unixSec === null) return "";
  const d = new Date(unixSec * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
}

/** `YYYY-MM-DD HH:mm:ss`。到秒 —— 文件时间要精确到秒才有排查价值。 */
function formatDateTime(unixSec: number | null): string {
  if (unixSec === null || unixSec <= 0) return "未知";
  const d = new Date(unixSec * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** `HH:MM:SS`。 */
function formatClock(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export default function FileTransferPanel({
  tabId,
  toolType,
  workDir,
  panelHostRef,
}: FileTransferPanelProps) {
  const supported = toolType === "ssh" || toolType === "terminal";
  const isSsh = toolType === "ssh";

  const [open, setOpen] = useState(false);
  /** 放大后铺满终端区域，再点恢复。照抄 TranscriptPanel 的做法。 */
  const [maximized, setMaximized] = useState(false);
  /** 是否列出隐藏文件。眼睛图标切换，远程与本地两栏一起生效。 */
  const [showHidden, setShowHidden] = useState(true);
  const [connModalOpen, setConnModalOpen] = useState(false);

  /** Terminal 会话没有远程信息，只能手填一次；填完存到 state，不落库。 */
  const [manualArgs, setManualArgs] = useState<SshArgs | null>(null);

  // 路径只有一份状态（输入框里显示的就是被列举的路径），另配一个刷新计数：
  // 边打字边列举会连着开一堆 SSH 连接，代价远大于收益；而计数让「路径没变也
  // 重新列举」成为可能 —— 直接 set 同一个值会被 React 当成没变而跳过。
  const [remotePath, setRemotePath] = useState("~/");
  const [remoteRev, setRemoteRev] = useState(0);
  const [localPath, setLocalPath] = useState(workDir ?? "");
  const [localRev, setLocalRev] = useState(0);

  // 列举时读路径的当前值。放 ref 是因为列举不该被「打字」触发，
  // 但 ref 里的值永远是最新的。
  const remotePathRef = useRef(remotePath);
  remotePathRef.current = remotePath;
  const localPathRef = useRef(localPath);
  localPathRef.current = localPath;

  const [remoteEntries, setRemoteEntries] = useState<DirEntry[]>([]);
  const [localEntries, setLocalEntries] = useState<DirEntry[]>([]);
  const [remoteSel, setRemoteSel] = useState<string[]>([]);
  const [localSel, setLocalSel] = useState<string[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [localLoading, setLocalLoading] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const [rows, setRows] = useState<LogRow[]>([]);
  const requestSeq = useRef(0);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panesRef = useRef<HTMLDivElement>(null);
  /**
   * 日志表体的高度。
   *
   * 放大后文件列表不再无限长高（那会把日志表挤出可视区），多出来的空间给日志表。
   * 表体高度得按面板实际高度算 —— 终端尺寸是变的，写死会在矮终端里被裁掉。
   */
  const [logHeight, setLogHeight] = useState(132);

  const targetFor = useCallback((): SshTarget | null => {
    if (isSsh) return { kind: "fromSession", sessionId: tabId };
    if (manualArgs) {
      return {
        kind: "manual",
        hostname: manualArgs.hostname,
        port: manualArgs.port,
        username: manualArgs.username || undefined,
        password: manualArgs.password || undefined,
        identityFile: manualArgs.identityFile || undefined,
      };
    }
    return null;
  }, [isSsh, tabId, manualArgs]);

  /**
   * 目标标识。放进依赖数组用 —— `targetFor()` 每次渲染都返回新对象，
   * 直接进依赖会让列举 effect 每帧重跑。刻意不含密码。
   */
  const targetKey = isSsh
    ? `s:${tabId}`
    : manualArgs
      ? `m:${manualArgs.hostname}:${manualArgs.port}:${manualArgs.username}`
      : "";

  // 版本号让「路径没变也重新列举」成为可能：直接 set 同一个路径值会被
  // React 当成没变而跳过，列表就停在旧内容上。
  /** 只重新列举当前目录，不动路径输入框。 */
  const refreshRemote = useCallback(() => setRemoteRev((v) => v + 1), []);
  const refreshLocal = useCallback(() => setLocalRev((v) => v + 1), []);

  const applyRemote = useCallback((p: string) => {
    setRemotePath(p);
    setRemoteRev((v) => v + 1);
  }, []);
  const applyLocal = useCallback((p: string) => {
    setLocalPath(p);
    setLocalRev((v) => v + 1);
  }, []);

  // 进度事件 → 日志行。并发传输靠 requestId 对齐行与行。
  useEffect(() => {
    let disposed = false;
    let dispose: (() => void) | undefined;
    const unlisten = listen<TransferProgress>("ssh_transfer:progress", (event) => {
      const p = event.payload;
      if (p.tabId !== tabId) return;
      setRows((prev) =>
        prev.map((r) =>
          r.requestId === p.requestId
            ? {
                ...r,
                bytes: p.bytes,
                totalBytes: p.totalBytes ?? r.totalBytes,
                transferId: p.transferId,
              }
            : r,
        ),
      );
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

  // 面板打开时探测远程 cwd。探测失败不是错误 —— 回落 ~/，输入框一直可改。
  useEffect(() => {
    if (!open || !isSsh) return;
    let cancelled = false;
    void (async () => {
      try {
        const cwd = await sshProbeRemoteCwd(tabId);
        if (!cancelled) applyRemote(cwd);
      } catch {
        if (!cancelled) applyRemote("~/");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, isSsh, tabId, applyRemote]);

  // 列举远程目录
  useEffect(() => {
    if (!open) return;
    if (!targetKey) {
      setRemoteEntries([]);
      setRemoteError(null);
      setRemoteLoading(false);
      return;
    }
    const target = targetFor();
    if (!target) return;
    let cancelled = false;
    const path = remotePathRef.current;
    setRemoteLoading(true);
    void sshListDir(target, path, showHidden)
      .then((entries) => {
        if (cancelled) return;
        setRemoteEntries(entries);
        setRemoteSel([]);
        setRemoteError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setRemoteEntries([]);
        setRemoteError(typeof e === "string" ? e : "无法列出远程目录");
      })
      .finally(() => {
        if (!cancelled) setRemoteLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, remoteRev, targetKey, targetFor, showHidden]);

  // 列举本地目录
  useEffect(() => {
    if (!open || !localPath) return;
    let cancelled = false;
    const path = localPathRef.current;
    setLocalLoading(true);
    void fsListDir(path, showHidden)
      .then((entries) => {
        if (cancelled) return;
        setLocalEntries(entries);
        setLocalSel([]);
        setLocalError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setLocalEntries([]);
        setLocalError(typeof e === "string" ? e : "无法列出本地目录");
      })
      .finally(() => {
        if (!cancelled) setLocalLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, localRev, showHidden]);

  // 项目目录后到时补上默认落点
  useEffect(() => {
    if (!localPath && workDir) applyLocal(workDir);
  }, [workDir, localPath, applyLocal]);

  // 放大时按面板实际高度算日志表体的高度
  useEffect(() => {
    if (!maximized) {
      setLogHeight(132);
      return;
    }
    const el = panelRef.current;
    if (!el) return;
    const measure = () => {
      const panesH = panesRef.current?.offsetHeight ?? 0;
      // 面板里除文件列表与日志表体外的部分：头部 40 + 日志标题 25
      // + 表头 18 + 表格容器上内边距 8 + 底部留白 5
      const chrome = 96;
      setLogHeight(Math.max(72, el.clientHeight - panesH - chrome));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [maximized, open]);

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

  const nextRequestId = () => {
    requestSeq.current += 1;
    return `r${Date.now().toString(36)}-${requestSeq.current}`;
  };

  const pushRow = (row: LogRow) => {
    setRows((prev) => [...prev, row]);
  };

  const settleRow = (
    requestId: string,
    state: RowState,
    error?: string,
    bytes?: number,
  ) => {
    setRows((prev) =>
      prev.map((r) =>
        r.requestId === requestId
          ? { ...r, state, error, bytes: bytes ?? r.bytes }
          : r,
      ),
    );
  };

  /** 上传若干本地文件 → 远程当前目录。 */
  const startUploads = (files: DirEntry[]) => {
    if (!targetKey) {
      setConnModalOpen(true);
      return;
    }
    const target = targetFor();
    if (!target) return;

    for (const f of files) {
      const requestId = nextRequestId();
      pushRow({
        requestId,
        direction: "upload",
        name: f.name,
        size: f.size,
        startedAt: Date.now(),
        bytes: 0,
        totalBytes: null,
        state: "running",
      });
      void sshUpload({
        target,
        tabId,
        localPaths: [f.path],
        remotePath: remotePathRef.current,
        requestId,
      })
        .then((s) => {
          settleRow(requestId, "done", undefined, s.files[0]?.bytes);
          // 传完就把对端目录重新列一遍：刚落地的文件要立刻出现在列表里
          refreshRemote();
        })
        .catch((e) =>
          settleRow(requestId, "error", typeof e === "string" ? e : "上传失败"),
        );
    }
  };

  /** 下载若干远程文件 → 本地当前目录。 */
  const startDownloads = (files: DirEntry[]) => {
    if (!targetKey) {
      setConnModalOpen(true);
      return;
    }
    const target = targetFor();
    if (!target) return;

    for (const f of files) {
      const requestId = nextRequestId();
      pushRow({
        requestId,
        direction: "download",
        name: f.name,
        size: f.size,
        startedAt: Date.now(),
        bytes: 0,
        totalBytes: null,
        state: "running",
      });
      void sshDownload({
        target,
        tabId,
        remotePath: f.path,
        localDir: localPathRef.current,
        requestId,
      })
        .then((s) => {
          settleRow(requestId, "done", undefined, s.files[0]?.bytes);
          refreshLocal();
        })
        .catch((e) =>
          settleRow(requestId, "error", typeof e === "string" ? e : "下载失败"),
        );
    }
  };

  const cancelRow = async (row: LogRow) => {
    if (!row.transferId) return;
    await sshTransferCancel(row.transferId).catch(() => {});
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

  const columns: ColumnsType<LogRow> = [
    {
      title: "方式",
      dataIndex: "direction",
      width: 52,
      align: "center",
      render: (d: Direction) => (
        <Tooltip title={d === "upload" ? "上传" : "下载"} placement="left">
          {d === "upload" ? (
            <CloudUploadOutlined style={{ color: "var(--ant-color-blue)" }} />
          ) : (
            <CloudDownloadOutlined style={{ color: "var(--ant-color-green)" }} />
          )}
        </Tooltip>
      ),
    },
    {
      title: "文件名",
      dataIndex: "name",
      ellipsis: true,
    },
    {
      title: "大小",
      dataIndex: "size",
      width: 92,
      align: "right",
      render: (s: number) => formatBytes(s),
    },
    {
      title: "开始时间",
      dataIndex: "startedAt",
      width: 88,
      render: (t: number) => formatClock(t),
    },
    {
      title: "进度",
      dataIndex: "bytes",
      width: 168,
      render: (_, row) => {
        if (row.state === "error") {
          return (
            <span
              className="text-xs"
              style={{ color: "var(--ant-color-error)" }}
              title={row.error}
            >
              {row.error ?? "失败"}
            </span>
          );
        }
        // 下载方向后端给不出总量（要另开连接问），用列表里看到的文件大小兜底
        const total = row.totalBytes ?? row.size;
        if (total <= 0) {
          // 拿不到总量就不编造百分比，只报已传字节
          return (
            <span className="text-xs text-[var(--ant-color-text-secondary)]">
              {row.state === "running"
                ? `已传 ${formatBytes(row.bytes)}`
                : `已完成 ${formatBytes(row.bytes)}`}
            </span>
          );
        }
        const percent = Math.min(100, Math.round((row.bytes / total) * 100));
        return (
          <div className="flex items-center gap-1">
            {row.state === "running" ? (
              <Progress
                size="small"
                percent={percent}
                status="active"
                style={{ flex: 1, marginBottom: 0, lineHeight: 1 }}
              />
            ) : (
              // 完成的行也显示 100%，而不是 AntD 的对勾图标 ——
              // status="success" 会把百分比文字换成对勾，得自己给 format
              <Progress
                size="small"
                percent={100}
                strokeColor="var(--ant-color-success)"
                format={() => "100%"}
                style={{ flex: 1, marginBottom: 0, lineHeight: 1 }}
              />
            )}
            {row.state === "running" && (
              <Tooltip title="取消">
                <Button
                  size="small"
                  type="text"
                  icon={<StopOutlined />}
                  onClick={() => void cancelRow(row)}
                />
              </Tooltip>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <Tooltip
        title={isSsh ? "文件传输" : "本地文件 / 传文件"}
        placement="left"
      >
        <button
          ref={buttonRef}
          onClick={() => {
            setOpen((v) => !v);
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
          {isSsh ? (
            <CloudUploadOutlined style={{ fontSize: 14 }} />
          ) : (
            <SnippetsOutlined style={{ fontSize: 14 }} />
          )}
        </button>
      </Tooltip>

      <SshConnectionModal
        open={connModalOpen}
        onClose={() => setConnModalOpen(false)}
        onConfirm={(args) => {
          setManualArgs(args);
        }}
      />

      {open &&
        panelHostRef.current &&
        createPortal(
          <div
            ref={panelRef}
            className={`absolute z-20 flex flex-col ${
              // 上、右都留 2.5rem（10），与右边的距离对称
              maximized ? "top-0 right-0" : "top-10 right-10"
            }`}
            style={{
              ...PANEL_STYLE,
              width: maximized ? "100%" : PANEL_STYLE.width,
              // 全屏时高度也铺满，只给宽度不够
              height: maximized ? "100%" : undefined,
              maxHeight: maximized ? "100%" : PANEL_STYLE.maxHeight,
              borderRadius: maximized ? 0 : PANEL_STYLE.borderRadius,
            }}
          >
            <div
              className="flex items-center gap-2 px-3 py-2"
              style={{ borderBottom: "1px solid var(--ant-color-border-secondary)" }}
            >
              <span className="text-sm font-medium flex-1">文件传输</span>
              <Tooltip title={showHidden ? "不显示隐藏文件" : "显示隐藏文件"}>
                <button
                  onClick={() => setShowHidden((v) => !v)}
                  aria-label={showHidden ? "不显示隐藏文件" : "显示隐藏文件"}
                  style={ICON_BTN_STYLE}
                >
                  {showHidden ? (
                    <EyeOutlined style={{ fontSize: 13 }} />
                  ) : (
                    <EyeInvisibleOutlined style={{ fontSize: 13 }} />
                  )}
                </button>
              </Tooltip>
              <Tooltip title={maximized ? "恢复默认大小" : "最大化"}>
                <button
                  onClick={() => setMaximized((v) => !v)}
                  aria-label={maximized ? "恢复默认大小" : "最大化"}
                  style={ICON_BTN_STYLE}
                >
                  {maximized ? (
                    <FullscreenExitOutlined style={{ fontSize: 13 }} />
                  ) : (
                    <FullscreenOutlined style={{ fontSize: 13 }} />
                  )}
                </button>
              </Tooltip>
              <button
                onClick={() => setOpen(false)}
                aria-label="关闭"
                style={ICON_BTN_STYLE}
              >
                <CloseOutlined style={{ fontSize: 13 }} />
              </button>
            </div>

            <div
              ref={panesRef}
              className="flex px-3 pt-2"
              style={{
                gap: 6,
                // 放大时两栏不再长高 —— 长高会把日志表挤出可视区
                flex: maximized ? "0 0 auto" : "1 1 auto",
                minHeight: 0,
                // 列表底边到下方分隔线的留白，两栏统一
                paddingBottom: 5,
              }}
            >
              <FilePane
                title="远程文件目录"
                path={remotePath}
                onPathChange={setRemotePath}
                onApply={() => applyRemote(remotePath)}
                entries={remoteEntries}
                loading={remoteLoading}
                error={remoteError}
                selected={remoteSel}
                onToggle={(p) =>
                  setRemoteSel((prev) =>
                    prev.includes(p)
                      ? prev.filter((x) => x !== p)
                      : [...prev, p],
                  )
                }
                onNavigate={(p) => applyRemote(p)}
                onActivate={(e) => startDownloads([e])}
                listMaxHeight={300}
                placeholder="远程目录，如 /var/log"
                hint={
                  isSsh
                    ? undefined
                    : "本地终端会话没有远程信息，需先填写连接参数"
                }
                extra={
                  !isSsh && !targetKey ? (
                    <Button size="small" onClick={() => setConnModalOpen(true)}>
                      填写参数
                    </Button>
                  ) : null
                }
              />
              <div
                className="flex flex-col items-center justify-center"
                style={{ width: 30, gap: 50 }}
              >
                <Tooltip title="上传到远程（本地 → 远程）" placement="left">
                  <button
                    onClick={() =>
                      startUploads(
                        localEntries.filter(
                          (e) => !e.isDir && localSel.includes(e.path),
                        ),
                      )
                    }
                    className="flex flex-col items-center justify-center rounded transition-all"
                    style={{
                      width: 28,
                      padding: "3px 0",
                      gap: 1,
                      background: "var(--ant-color-bg-elevated)",
                      border: "1px solid var(--ant-color-border-secondary)",
                      cursor: "pointer",
                      color: "var(--ant-color-text-secondary)",
                      fontSize: 10,
                      lineHeight: "10px",
                    }}
                  >
                    <CloudUploadOutlined style={{ fontSize: 13 }} />
                    <span>&lt;&lt;</span>
                  </button>
                </Tooltip>
                <Tooltip title="从远程下载（远程 → 本地）" placement="right">
                  <button
                    onClick={() =>
                      startDownloads(
                        remoteEntries.filter(
                          (e) => !e.isDir && remoteSel.includes(e.path),
                        ),
                      )
                    }
                    className="flex flex-col items-center justify-center rounded transition-all"
                    style={{
                      width: 28,
                      padding: "3px 0",
                      gap: 1,
                      background: "var(--ant-color-bg-elevated)",
                      border: "1px solid var(--ant-color-border-secondary)",
                      cursor: "pointer",
                      color: "var(--ant-color-text-secondary)",
                      fontSize: 10,
                      lineHeight: "10px",
                    }}
                  >
                    <CloudDownloadOutlined style={{ fontSize: 13 }} />
                    <span>&gt;&gt;</span>
                  </button>
                </Tooltip>
              </div>
              <FilePane
                title="本地文件目录"
                path={localPath}
                onPathChange={setLocalPath}
                onApply={() => applyLocal(localPath)}
                entries={localEntries}
                loading={localLoading}
                error={localError}
                selected={localSel}
                onToggle={(p) =>
                  setLocalSel((prev) =>
                    prev.includes(p)
                      ? prev.filter((x) => x !== p)
                      : [...prev, p],
                  )
                }
                onNavigate={(p) => applyLocal(p)}
                onActivate={(e) => startUploads([e])}
                listMaxHeight={300}
                placeholder="本地目录，如 /home/me/proj"
                extra={
                  !isSsh ? (
                    <Tooltip title="插入本地路径到终端">
                      <Button
                        size="small"
                        type="text"
                        icon={<SnippetsOutlined />}
                        onClick={() => void handleInsertPath()}
                      />
                    </Tooltip>
                  ) : null
                }
              />
            </div>

            <div
              className="px-3 pt-2"
              style={{
                borderTop: "1px solid var(--ant-color-border-secondary)",
                // 表格底边到面板底边的留白
                paddingBottom: 5,
              }}
            >
              <div className="text-xs font-medium mb-1">同步进度和日志</div>
              <Table<LogRow>
                className="transfer-log-table"
                components={COMPACT_TABLE}
                size="small"
                columns={columns}
                dataSource={rows}
                rowKey="requestId"
                pagination={false}
                scroll={{ y: logHeight }}
                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无传输记录" /> }}
              />
            </div>
          </div>,
          panelHostRef.current,
        )}
    </>
  );
}

/** 一栏文件列表：路径输入框 + 可导航的条目列表。 */
function FilePane({
  title,
  path,
  onPathChange,
  onApply,
  entries,
  loading,
  error,
  selected,
  onToggle,
  onNavigate,
  onActivate,
  placeholder,
  listMaxHeight,
  hint,
  extra,
}: {
  title: string;
  path: string;
  onPathChange: (p: string) => void;
  onApply: () => void;
  entries: DirEntry[];
  loading: boolean;
  error: string | null;
  selected: string[];
  onToggle: (path: string) => void;
  onNavigate: (path: string) => void;
  /** 双击文件条目时触发（文件夹的双击仍是进入目录）。 */
  onActivate?: (entry: DirEntry) => void;
  placeholder: string;
  /** 列表的最大高度。全屏时放开，上限交给面板。 */
  listMaxHeight?: number | string;
  /** 没有内容可列时的原因说明，比「空目录」有信息量。 */
  hint?: string;
  extra?: React.ReactNode;
}) {
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  /**
   * 双击判定自己做，不靠 onDoubleClick。
   *
   * 浏览器把两次点击合成 dblclick 的条件（间隔、位置）在不同后端上并不一致，
   * 合成事件更是常常只给出两次 click。自己记时间戳更可控。
   */
  const lastClickRef = useRef<{ path: string; at: number } | null>(null);

  const handleClick = (e: DirEntry) => {
    if (e.isDir) {
      onNavigate(e.path);
      return;
    }
    const now = Date.now();
    const last = lastClickRef.current;
    if (last && last.path === e.path && now - last.at < 400) {
      // 第二次点击：当作双击，传文件
      lastClickRef.current = null;
      onActivate?.(e);
      return;
    }
    lastClickRef.current = { path: e.path, at: now };
    onToggle(e.path);
  };

  return (
    <div
      className="flex flex-col"
      style={{ flex: 1, minWidth: 0, gap: 4 }}
    >
      <div className="flex items-center gap-1">
        <span className="text-xs" style={{ whiteSpace: "nowrap" }}>
          {title}:
        </span>
        <Input
          size="small"
          value={path}
          onChange={(e) => onPathChange(e.target.value)}
          onPressEnter={onApply}
          placeholder={placeholder}
          style={{ flex: 1 }}
        />
        {extra}
      </div>
      <div
        className="overflow-y-auto"
        style={{
          flex: "1 1 auto",
          minHeight: 120,
          maxHeight: listMaxHeight ?? 300,
          overflowY: "auto",
          border: "1px solid var(--ant-color-border-secondary)",
          borderRadius: 6,
          padding: 2,
        }}
      >
        {error && (
          <div
            className="text-xs px-2 py-1"
            style={{ color: "var(--ant-color-error)" }}
          >
            {error}
          </div>
        )}
        {!error && loading && entries.length === 0 && (
          <div className="text-xs px-2 py-1 text-[var(--ant-color-text-tertiary)]">
            读取中…
          </div>
        )}
        {!error && !loading && entries.length === 0 && (
          <div className="text-xs px-2 py-1 text-[var(--ant-color-text-tertiary)]">
            {hint ?? (path.trim() ? "空目录" : "请填写目录路径")}
          </div>
        )}
        <ParentEntry path={path} onNavigate={onNavigate} />
        {entries.map((e) => {
          const active = selectedSet.has(e.path);
          return (
            <Tooltip
              key={e.path}
              placement="left"
              title={
                <div className="text-xs" style={{ lineHeight: "1.6" }}>
                  <div style={{ wordBreak: "break-all" }}>{e.path}</div>
                  <div>大小：{e.isDir ? "—" : formatBytes(e.size)}</div>
                  <div>创建：{formatDateTime(e.created)}</div>
                  <div>修改：{formatDateTime(e.modified)}</div>
                </div>
              }
            >
              <div
                className="flex items-center gap-1 px-1 py-0.5 cursor-pointer rounded"
                style={{
                  background: active
                    ? "var(--ant-color-primary-bg)"
                    : "transparent",
                }}
                onClick={() => handleClick(e)}
              >
                {e.isDir ? (
                  <FolderOutlined style={{ color: "var(--ant-color-text-tertiary)" }} />
                ) : (
                  <FileOutlined style={{ color: "var(--ant-color-text-tertiary)" }} />
                )}
                <span className="flex-1 text-xs truncate">{e.name}</span>
                <span
                  className="text-xs"
                  style={{ color: "var(--ant-color-text-tertiary)" }}
                >
                  {formatDate(e.modified)}
                </span>
              </div>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

/** 列表顶部的「..」—— 回上一级。 */
function ParentEntry({
  path,
  onNavigate,
}: {
  path: string;
  onNavigate: (path: string) => void;
}) {
  return (
    <div
      className="flex items-center gap-1 px-1 py-0.5 cursor-pointer rounded"
      onClick={() => onNavigate(parentPath(path))}
      title="上一级"
    >
      <FolderOpenOutlined style={{ color: "var(--ant-color-text-tertiary)" }} />
      <span className="flex-1 text-xs truncate">..</span>
    </div>
  );
}
