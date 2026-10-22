import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Terminal } from "@xterm/xterm";
import {
  MessageOutlined,
  AimOutlined,
  ReloadOutlined,
  CloseOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import { Tooltip } from "antd";
import { claudeTranscriptRead } from "../../utils/ipc";
import type { TranscriptEntry } from "../../types";

interface TranscriptPanelProps {
  tabId: string;
  toolType: string;
  cliSessionId?: string | null;
  workDir?: string | null;
  claudeConfigDir?: string | null;
  xtermRef: React.RefObject<Terminal | null>;
  /**
   * 面板的 portal 宿主(终端根容器)。
   * 面板必须以它为包含块,max-height 的百分比才能解析成终端容器高度的对应比例;
   * 若留在按钮的包装 div 内,包含块高度只有 32px,面板会被压到 25px 并裁掉标题栏。
   */
  panelHostRef: React.RefObject<HTMLElement | null>;
}

type LoadState = "idle" | "loading" | "ready" | "missing" | "error";

const AI_TOOLS = new Set(["claude", "codex", "gemini", "antigravity", "opencode"]);

/** 从消息正文里取一个能用于终端定位的锚点。
 *
 * 关键词必须短且唯一 —— 直接拿整句去搜会因为终端按行断行而搜不到。
 * 取开头 12 个非空白字符已经足够区分同一会话里的不同提问。
 */
function anchorOf(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 12) return cleaned;
  return cleaned.slice(0, 12);
}

/**
 * 逐字段比较两份会话记录是否等价。
 *
 * 面板每 8 秒全量重拉一次,而 invoke 每次都会反序列化出全新的数组 —— 即使内容
 * 一字未改,引用也必然不同。若直接 setEntries,visible 的 useMemo 会失效并触发
 * "滚到底部"的 effect,用户往上翻看历史时会被周期性拽回去。
 * 无变化时保留旧引用,既不重渲染也不打断滚动。
 */
function sameEntries(a: TranscriptEntry[], b: TranscriptEntry[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((e, i) => {
    const o = b[i];
    return (
      o.uuid === e.uuid &&
      o.kind === e.kind &&
      o.text === e.text &&
      o.timestamp === e.timestamp &&
      o.toolName === e.toolName
    );
  });
}

/**
 * 一次提问及其后 AI/工具的全部回应。
 * 面板只列提问,回应默认收起 —— 用户翻历史时先看"问了什么",需要时再展开细节。
 */
interface TranscriptThread {
  /** 用提问的 uuid 作 key,保证轮询刷新后展开状态仍能对上同一条 */
  key: string;
  prompt: TranscriptEntry;
  replies: TranscriptEntry[];
}

function threadKeyOf(e: TranscriptEntry, i: number): string {
  return e.uuid || `idx-${i}-${e.timestamp}`;
}

/**
 * 把扁平的主线记录切成「提问 → 回应」两层。
 * 首个提问之前的 AI/工具记录没有归属提问,按"只列用户输入"的语义丢弃。
 */
function groupThreads(entries: TranscriptEntry[]): TranscriptThread[] {
  const threads: TranscriptThread[] = [];
  entries.forEach((e, i) => {
    if (e.kind === "user") {
      threads.push({ key: threadKeyOf(e, i), prompt: e, replies: [] });
    } else if (threads.length > 0) {
      threads[threads.length - 1].replies.push(e);
    }
  });
  return threads;
}

/**
 * 在终端 scrollback 里找关键词并滚动过去。
 *
 * Claude Code 用固定前缀标记消息类型（❯ 用户输入 / ● AI 回复 / ⎿ 工具输出），
 * pyte 实测确认这些前缀确实落在 buffer 里，所以拿它当二次校验，
 * 避免同词多次出现时跳错地方。
 */
function locateInTerminal(
  xtermRef: React.RefObject<Terminal | null>,
  keyword: string,
  expectedPrefix: string,
  fromY: number,
): number | null {
  const term = xtermRef.current;
  if (!term || !keyword) return null;
  const buf = term.buffer.active;
  const hits: number[] = [];
  for (let y = fromY; y < buf.length; y++) {
    const line = buf.getLine(y);
    if (!line) continue;
    if (line.translateToString(true).includes(keyword)) {
      hits.push(y);
      // 前缀命中即可确认，再多找只是浪费
      if (line.translateToString(true).trimStart().startsWith(expectedPrefix)) {
        return y;
      }
    }
  }
  return hits.length > 0 ? hits[0] : null;
}

export default function TranscriptPanel({
  tabId,
  toolType,
  cliSessionId,
  workDir,
  claudeConfigDir,
  xtermRef,
  panelHostRef,
}: TranscriptPanelProps) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [state, setState] = useState<LoadState>("idle");
  const [hint, setHint] = useState("");
  const [toolFilter, setToolFilter] = useState(true);
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const supported = AI_TOOLS.has(toolType);

  /**
 * @param background 后台轮询。为 true 时不进入 loading 态、失败也不改 state,
 *   让已渲染的列表保持原样 —— 否则条目会在读取期间消失,浏览器把 scrollTop
 *   钳到 0(内容塌缩),用户翻看历史时被拽回顶部,且每 8 秒闪一次"读取中…"。
 */
const load = useCallback(async (background = false) => {
    if (!cliSessionId || !workDir) {
      if (background) return;
      setState("missing");
      setHint("该会话没有记录 Claude 会话 ID，无法读取");
      return;
    }
    if (!background) setState("loading");
    try {
      const data = await claudeTranscriptRead(cliSessionId, workDir, claudeConfigDir ?? null, 400);
      if (!data) {
        if (background) return;
        setEntries([]);
        setState("missing");
        setHint("未找到该会话的 transcript 文件");
        return;
      }
      setEntries((prev) => (sameEntries(prev, data) ? prev : data));
      setState("ready");
      setHint("");
    } catch (err) {
      // 后台失败只提示、不改 state:state 若是 error 会让轮询定时器不再重建,
      // 面板从此永远不再自动更新。这里保持 ready,由下一轮轮询自行重试。
      if (background) {
        setHint(`刷新失败：${typeof err === "string" ? err : "读取失败"}，将自动重试`);
        return;
      }
      setState("error");
      setHint(typeof err === "string" ? err : "读取失败");
    }
  }, [cliSessionId, workDir, claudeConfigDir]);

  // tab 切换时自动拉一次：会话记录会随对话推进增长
  useEffect(() => {
    if (open) void load();
  }, [open, tabId, load]);

  // 会话运行中定时刷新，让面板跟得上正在进行的对话。
  // 不依赖 state —— 后台刷新失败时 load 不会再把 state 改成 error,
  // 这里若跟着 state 走就会在首次失败后永久停止刷新。
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => void load(true), 8000);
    return () => clearInterval(timer);
  }, [open, load]);

  const threads = useMemo(() => groupThreads(entries), [entries]);

  // 点击按钮或面板之外的任何位置(终端正文、主界面其他区域)都收起面板。
  // 用 pointerdown 而非 click:它是 click 之前的事件,打开面板的那一次点击
  // 不会落到这里 —— 此时 open 还是 false,监听器尚未挂上。
  // 按钮和面板分属两个容器(面板经 portal 挂在终端根节点下),必须分别判断,
  // 否则在面板里点一下会被当成"外部点击"而误关。
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

  const visibleReplies = useCallback(
    (t: TranscriptThread) =>
      toolFilter ? t.replies.filter((r) => r.kind !== "tool") : t.replies,
    [toolFilter],
  );

  const toggleThread = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [threads, open]);

  const jumpTo = useCallback(
    (entry: TranscriptEntry) => {
      const keyword = anchorOf(entry.text);
      const prefix = entry.kind === "user" ? "❯" : entry.kind === "assistant" ? "●" : "⎿";
      const found = locateInTerminal(xtermRef, keyword, prefix, cursorRef.current);
      if (found === null) {
        setHint(`「${keyword}」不在当前终端缓冲区中（可能已滚出或尚未显示）`);
        return;
      }
      xtermRef.current?.scrollToLine(found);
      cursorRef.current = found + 1;
      setHint("");
    },
    [xtermRef],
  );

  const toolCount = useMemo(() => entries.filter((e) => e.kind === "tool").length, [entries]);

  if (!supported) return null;

  return (
    <>
      <Tooltip title="会话记录" placement="left">
        <button
          ref={buttonRef}
          onClick={() => setOpen((v) => !v)}
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
          <MessageOutlined style={{ fontSize: 14 }} />
        </button>
      </Tooltip>

      {open && panelHostRef.current && createPortal(
        <div
          ref={panelRef}
          className="absolute top-10 right-10 z-20 flex flex-col"
          style={{
            width: 400,
            // 相对终端容器高度(panelHostRef)解析,不是视口高度。
            maxHeight: "78%",
            background: "var(--ant-color-bg-elevated)",
            border: "1px solid var(--ant-color-border-secondary)",
            borderRadius: 8,
            boxShadow: "0 6px 24px rgba(0,0,0,0.28)",
            overflow: "hidden",
          }}
        >
          <div
            className="flex items-center justify-between px-3 py-2"
            style={{ borderBottom: "1px solid var(--ant-color-border-secondary)" }}
          >
            <span className="text-sm font-medium">会话记录</span>
            <div className="flex items-center gap-1">
              <Tooltip title={toolFilter ? `已隐藏 ${toolCount} 条工具调用` : "显示工具调用"}>
                <button
                  onClick={() => setToolFilter((v) => !v)}
                  style={{
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: toolFilter
                      ? "var(--ant-color-text-tertiary)"
                      : "var(--ant-color-primary)",
                    padding: 2,
                  }}
                >
                  <ToolOutlined style={{ fontSize: 13 }} />
                </button>
              </Tooltip>
              <button
                onClick={() => void load()}
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--ant-color-text-secondary)",
                  padding: 2,
                }}
              >
                <ReloadOutlined style={{ fontSize: 13 }} />
              </button>
              <button
                onClick={() => setOpen(false)}
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
          </div>

          <div ref={scrollRef} className="flex-1 overflow-auto px-3 py-2">
            {state === "loading" && (
              <div className="text-xs text-[var(--ant-color-text-secondary)] py-4 text-center">
                读取中…
              </div>
            )}
            {(state === "missing" || state === "error") && (
              <div className="text-xs text-[var(--ant-color-text-secondary)] py-4 text-center">
                {hint || "未找到记录"}
              </div>
            )}
            {state === "ready" && threads.length === 0 && (
              <div className="text-xs text-[var(--ant-color-text-secondary)] py-4 text-center">
                本次会话暂无提问
              </div>
            )}

            {state === "ready" &&
              threads.map((t) => {
                const expanded = expandedKeys.has(t.key);
                const replies = visibleReplies(t);
                return (
                  <div
                    key={t.key}
                    className="group mb-2"
                    style={{ borderRadius: 6, overflow: "hidden" }}
                  >
                    <div
                      className="flex items-start gap-1"
                      style={{
                        padding: "6px 8px",
                        background: "var(--ant-color-primary-bg)",
                      }}
                    >
                      <button
                        onClick={() => toggleThread(t.key)}
                        title={expanded ? "收起回应" : "展开回应"}
                        aria-expanded={expanded}
                        style={{
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          color: "var(--ant-color-text-tertiary)",
                          padding: 0,
                          marginTop: 2,
                          width: 14,
                          height: 14,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flex: "0 0 auto",
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            lineHeight: 1,
                            display: "inline-block",
                            transform: expanded ? "rotate(90deg)" : undefined,
                            transition: "transform 0.15s",
                          }}
                        >
                          ❯
                        </span>
                      </button>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-[var(--ant-color-text-tertiary)]">
                            你
                            {t.prompt.timestamp > 0 &&
                              ` · ${new Date(t.prompt.timestamp).toLocaleTimeString("zh-CN", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}`}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-[var(--ant-color-text-tertiary)]">
                              {replies.length > 0
                                ? expanded
                                  ? "收起"
                                  : `${replies.length} 条回应`
                                : "无回应"}
                            </span>
                            <button
                              onClick={() => jumpTo(t.prompt)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity"
                              style={{
                                background: "transparent",
                                border: "none",
                                cursor: "pointer",
                                color: "var(--ant-color-text-secondary)",
                                padding: 0,
                              }}
                              title="定位到终端"
                            >
                              <AimOutlined style={{ fontSize: 12 }} />
                            </button>
                          </div>
                        </div>
                        <div
                          className="text-xs whitespace-pre-wrap break-words"
                          style={{
                            color: "var(--ant-color-text)",
                            display: "-webkit-box",
                            WebkitLineClamp: 6,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                          }}
                        >
                          {t.prompt.text}
                        </div>
                      </div>
                    </div>

                    {expanded && replies.length > 0 && (
                      <div className="pl-6 pr-2 pb-1.5">
                        {replies.map((r, ri) => {
                          const isTool = r.kind === "tool";
                          return (
                            <div
                              key={`${threadKeyOf(r, ri)}`}
                              className="mb-1"
                              style={{
                                padding: "5px 8px",
                                borderRadius: 6,
                                borderLeft: isTool
                                  ? "2px solid var(--ant-color-border)"
                                  : "2px solid var(--ant-color-border-secondary)",
                                opacity: isTool ? 0.75 : 1,
                              }}
                            >
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs text-[var(--ant-color-text-tertiary)]">
                                  {isTool ? `⎿ ${r.toolName ?? "工具"}` : "● Claude"}
                                  {r.timestamp > 0 &&
                                    ` · ${new Date(r.timestamp).toLocaleTimeString("zh-CN", {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}`}
                                </span>
                                {!isTool && (
                                  <button
                                    onClick={() => jumpTo(r)}
                                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                                    style={{
                                      background: "transparent",
                                      border: "none",
                                      cursor: "pointer",
                                      color: "var(--ant-color-text-secondary)",
                                      padding: 0,
                                    }}
                                    title="定位到终端"
                                  >
                                    <AimOutlined style={{ fontSize: 12 }} />
                                  </button>
                                )}
                              </div>
                              <div
                                className="text-xs whitespace-pre-wrap break-words"
                                style={{
                                  color: "var(--ant-color-text)",
                                  display: "-webkit-box",
                                  WebkitLineClamp: 6,
                                  WebkitBoxOrient: "vertical",
                                  overflow: "hidden",
                                }}
                              >
                                {r.text}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>

          {hint && state === "ready" && (
            <div
              className="text-xs px-3 py-1"
              style={{
                color: "var(--ant-color-warning)",
                borderTop: "1px solid var(--ant-color-border-secondary)",
              }}
            >
              {hint}
            </div>
          )}

          {state === "ready" && (
            <div
              className="text-xs px-3 py-1"
              style={{ borderTop: "1px solid var(--ant-color-border-secondary)" }}
            >
              <span className="text-[var(--ant-color-text-tertiary)]">
                共 {threads.length} 个提问
              </span>
            </div>
          )}
        </div>,
      panelHostRef.current,
    )}
    </>
  );
}
