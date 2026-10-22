import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
}: TranscriptPanelProps) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [state, setState] = useState<LoadState>("idle");
  const [hint, setHint] = useState("");
  const [toolFilter, setToolFilter] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef(0);

  const supported = AI_TOOLS.has(toolType);

  const load = useCallback(async () => {
    if (!cliSessionId || !workDir) {
      setState("missing");
      setHint("该会话没有记录 Claude 会话 ID，无法读取");
      return;
    }
    setState("loading");
    try {
      const data = await claudeTranscriptRead(cliSessionId, workDir, claudeConfigDir ?? null, 400);
      if (!data) {
        setEntries([]);
        setState("missing");
        setHint("未找到该会话的 transcript 文件");
        return;
      }
      setEntries(data);
      setState("ready");
      setHint("");
    } catch (err) {
      setState("error");
      setHint(typeof err === "string" ? err : "读取失败");
    }
  }, [cliSessionId, workDir, claudeConfigDir]);

  // tab 切换时自动拉一次：会话记录会随对话推进增长
  useEffect(() => {
    if (open) void load();
  }, [open, tabId, load]);

  // 会话运行中定时刷新，让面板跟得上正在进行的对话
  useEffect(() => {
    if (!open || state !== "ready") return;
    const timer = setInterval(() => void load(), 8000);
    return () => clearInterval(timer);
  }, [open, state, load]);

  const visible = useMemo(
    () => (toolFilter ? entries.filter((e) => e.kind !== "tool") : entries),
    [entries, toolFilter],
  );

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [visible, open]);

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

      {open && (
        <div
          className="absolute top-12 right-2 z-20 flex flex-col"
          style={{
            width: 400,
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
            {state === "ready" && visible.length === 0 && (
              <div className="text-xs text-[var(--ant-color-text-secondary)] py-4 text-center">
                本次会话暂无记录
              </div>
            )}

            {state === "ready" &&
              visible.map((e, i) => {
                const isUser = e.kind === "user";
                const isTool = e.kind === "tool";
                return (
                  <div
                    key={`${e.uuid}-${i}`}
                    className="group mb-2"
                    style={{
                      padding: "6px 8px",
                      borderRadius: 6,
                      background: isUser
                        ? "var(--ant-color-primary-bg)"
                        : "transparent",
                      borderLeft: isTool
                        ? "2px solid var(--ant-color-border)"
                        : "2px solid transparent",
                      opacity: isTool ? 0.75 : 1,
                    }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-[var(--ant-color-text-tertiary)]">
                        {isUser ? "❯ 你" : isTool ? `⎿ ${e.toolName ?? "工具"}` : "● Claude"}
                        {e.timestamp > 0 &&
                          ` · ${new Date(e.timestamp).toLocaleTimeString("zh-CN", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}`}
                      </span>
                      {!isTool && (
                        <button
                          onClick={() => jumpTo(e)}
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
                      {e.text}
                    </div>
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
                共 {visible.length} 条
              </span>
            </div>
          )}
        </div>
      )}
    </>
  );
}
