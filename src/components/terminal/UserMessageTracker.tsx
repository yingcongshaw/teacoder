import { useState, useRef, useCallback, useEffect } from "react";
import { Dropdown, Modal } from "antd";
import { MessageOutlined, AimOutlined } from "@ant-design/icons";
import { Terminal } from "@xterm/xterm";
import { sessionMessageList, sessionMessageCreate } from "../../utils/ipc";

interface TrackedMessage {
  id: string;
  text: string;
  timestamp: number;
  messageIndex: number;
  cursorY: number; // 用户输入时的光标 Y 位置
}

interface UserMessageTrackerProps {
  tabId: string;
  xtermRef: React.RefObject<Terminal | null>;
  trackerRef?: React.MutableRefObject<{
    captureInput: (text: string) => void;
    flushInput: () => void;
    handleEnter: () => void;
  } | null>;
}

export default function UserMessageTracker({ tabId, xtermRef, trackerRef }: UserMessageTrackerProps) {
  const [messages, setMessages] = useState<TrackedMessage[]>([]);
  const [popupVisible, setPopupVisible] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<TrackedMessage | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const pendingInputRef = useRef<string>("");
  const [loaded, setLoaded] = useState(false);
  const messageIndexRef = useRef(0);

  // 加载历史消息
  useEffect(() => {
    if (!loaded && tabId) {
      sessionMessageList(tabId)
        .then((msgs) => {
          const mapped: TrackedMessage[] = msgs.map((m, idx) => ({
            id: m.id,
            text: cleanMessage(m.content),
            timestamp: m.createdAt,
            messageIndex: idx,
            cursorY: m.lineIndex, // 使用 lineIndex 作为 cursorY
          }));
          if (msgs.length > 0) {
            messageIndexRef.current = msgs.length;
          }
          setMessages(mapped);
          setLoaded(true);
        })
        .catch(() => {
          setLoaded(true);
        });
    }
  }, [tabId, loaded]);

  const handleMessageSend = useCallback((text: string) => {
    if (!text.trim()) return;

    const currentIndex = messageIndexRef.current++;
    const trimmedText = text.trim();

    // 获取用户输入时的光标 Y 位置（用于精确定位）
    const term = xtermRef.current;
    const cursorY = term ? term.buffer.active.cursorY : 0;

    // 保存到后端
    sessionMessageCreate({
      sessionId: tabId,
      content: trimmedText,
      lineIndex: cursorY,
    })
      .then((msg) => {
        const trackedMessage: TrackedMessage = {
          id: msg.id,
          text: msg.content,
          timestamp: msg.createdAt,
          messageIndex: currentIndex,
          cursorY: cursorY,
        };
        setMessages((prev) => {
          const updated = [trackedMessage, ...prev];
          return updated;
        });
      })
      .catch(() => {
        // 失败时也保存到本地
        const trackedMessage: TrackedMessage = {
          id: crypto.randomUUID(),
          text: trimmedText,
          timestamp: Date.now(),
          messageIndex: currentIndex,
          cursorY: cursorY,
        };
        setMessages((prev) => {
          const updated = [trackedMessage, ...prev];
          return updated;
        });
      });
  }, [tabId, xtermRef]);

  // 过滤掉终端转义序列，保留纯用户输入
  // 转义序列通常以 ESC (0x1b) 或 [ 开头，后跟特定模式
  const isLikelyEscapeSequence = (text: string): boolean => {
    // 如果整个字符串以 ESC 开头，很可能是终端响应
    if (text.charCodeAt(0) === 0x1b) {
      return true;
    }
    // 常见终端响应模式：以 [ 开头，以字母结尾
    if (/^\[[\?;\d]*[a-zA-Z~]$/.test(text)) {
      return true;
    }
    // 以 [O 开头的是终端响应
    if (/^\[O/.test(text)) {
      return true;
    }
    return false;
  };

  // 清理文本中的转义序列残留
  const cleanMessage = (text: string): string => {
    if (!text) return "";

    // 移除所有以 [ 开头后跟数字/分号/问号并以字母/~ 结尾的转义序列
    // 同时移除控制字符
    return text
      .replace(/\x1b\[[\?;\d]*[a-zA-Z~]/g, "")  // ESC[... 序列
      .replace(/\[[\?;\d]*[a-zA-Z~]/g, "")       // [...] 序列（不带 ESC）
      .replace(/\[O[^\s\w]*/g, "")                 // [O... 序列
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") // 控制字符
      .replace(/�/g, "")                            // Unicode 替代字符
      .trim();
  };

  const captureInput = useCallback((text: string) => {
    // 跳过明显的终端转义序列
    if (isLikelyEscapeSequence(text)) {
      return;
    }
    pendingInputRef.current += text;
  }, []);

  const flushInput = useCallback(() => {
    const input = pendingInputRef.current;
    // 清空前先清理可能混入的转义序列
    const cleaned = cleanMessage(input);
    pendingInputRef.current = "";
    if (cleaned) {
      handleMessageSend(cleaned);
    }
  }, [handleMessageSend]);

  // 处理 Enter 键时，确保所有字节都已到达
  const handleFlushWithDelay = useCallback(() => {
    // 延迟 50ms 确保 IME/输入法完成组合
    setTimeout(() => {
      flushInput();
    }, 50);
  }, [flushInput]);

  const handleEnter = useCallback(() => {
    // 延迟 flush 确保 IME/输入法完成组合（如 emoji）
    handleFlushWithDelay();
  }, [handleFlushWithDelay]);

  useEffect(() => {
    if (trackerRef) {
      trackerRef.current = {
        captureInput,
        flushInput,
        handleEnter,
      };
    }
  }, [trackerRef, captureInput, flushInput, handleEnter]);

  const scrollToMessage = useCallback((message: TrackedMessage) => {
    const term = xtermRef.current;
    if (!term) return;

    // 计算目标行号：用户输入时的光标位置
    const currentLength = term.buffer.active.length;

    // 如果消息的光标位置还有效（没有被滚出缓冲区），直接跳转
    if (message.cursorY >= 0 && message.cursorY < currentLength) {
      term.scrollToLine(message.cursorY);
    } else {
      // 否则滚动到消息位置附近
      const historyOffset = Math.min(message.messageIndex + 1, 10);
      const targetLine = Math.max(0, currentLength - historyOffset * 20);
      term.scrollToLine(targetLine);
    }

    setPopupVisible(false);
  }, [xtermRef]);

  const handlePopupVisibleChange = useCallback((visible: boolean) => {
    setPopupVisible(visible);
  }, []);

  const handleMessageClick = useCallback((message: TrackedMessage) => {
    setSelectedMessage(message);
    setDetailVisible(true);
    setPopupVisible(false);
  }, []);

  const handleJumpClick = useCallback((message: TrackedMessage, e: React.MouseEvent) => {
    e.stopPropagation();
    scrollToMessage(message);
    setPopupVisible(false);
  }, [scrollToMessage]);

  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  };

  // 清理文本，移除无效字符但保留有效内容
  const cleanText = (text: string): string => {
    if (!text) return "";

    // 移除控制字符（0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F, 0x7F）
    // 但保留换行、制表符等有效控制字符
    let cleaned = text
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .replace(/�+/g, '')  // 移除 Unicode 替代字符
      .trim();

    return cleaned;
  };

  // 检测文本是否为有效内容（非乱码）
  const isValidContent = (str: string): boolean => {
    if (!str || str.length === 0) return false;
    // 检查是否全是控制字符或替代字符
    if (/^[\x00-\x1F\x7F�\s]+$/.test(str)) return false;
    // 检查是否过短且无有效字符
    if (str.length < 2 && !/[一-鿿぀-ゟ゠-ヿ\w]/.test(str)) return false;
    return true;
  };

  const formatPreview = (text: string | null | undefined): string => {
    if (!text) return "(空消息)";

    const cleaned = cleanText(text);
    if (!cleaned) return "(空消息)";
    if (!isValidContent(cleaned)) return "(特殊内容)";

    // 正确处理 Unicode 字符截断，支持 emoji 和多字节字符
    const maxChars = 40;
    let charCount = 0;
    let breakIndex = cleaned.length;

    for (let i = 0; i < cleaned.length; i++) {
      const code = cleaned.charCodeAt(i);

      // 处理 UTF-16 代理对（emoji 和某些 Unicode 字符）
      if (code >= 0xD800 && code <= 0xDBFF) {
        charCount += 2;
        if (charCount > maxChars) {
          breakIndex = i;
          break;
        }
        continue;
      }

      // 跳过变体选择符等修饰符
      if (code >= 0xFE00 && code <= 0xFE0F) {
        continue;
      }

      charCount += 1;
      if (charCount > maxChars) {
        breakIndex = i;
        break;
      }
    }

    const result = breakIndex < cleaned.length
      ? cleaned.slice(0, breakIndex) + "..."
      : cleaned;

    return result || "(空消息)";
  };

  const menuItems = messages.length === 0
    ? [{ key: "empty", label: "暂无用户消息", disabled: true }]
    : messages.map((msg) => ({
        key: msg.id,
        label: (
          <div
            className="flex items-center gap-2 py-1 px-1 cursor-pointer hover:bg-[var(--ant-color-bg-elevated)] rounded transition-colors"
            onClick={() => handleMessageClick(msg)}
          >
            <div className="flex flex-col gap-0.5 flex-1 min-w-0">
              <span className="text-xs text-[var(--ant-color-text-secondary)]">
                #{msg.messageIndex + 1} · {formatTime(msg.timestamp)}
              </span>
              <span className="text-sm text-[var(--ant-color-text)] truncate">
                {formatPreview(msg.text)}
              </span>
            </div>
            <button
              title="跳转到此消息"
              className="flex items-center justify-center rounded transition-colors flex-shrink-0"
              style={{
                width: 24,
                height: 24,
                color: "var(--ant-color-text-secondary)",
              }}
              onClick={(e) => handleJumpClick(msg, e)}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--ant-color-primary)";
                e.currentTarget.style.backgroundColor = "var(--ant-color-bg-elevated)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--ant-color-text-secondary)";
                e.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              <AimOutlined style={{ fontSize: 12 }} />
            </button>
          </div>
        ),
      }));

  return (
    <>
      <Dropdown
        menu={{ items: menuItems }}
        trigger={["click"]}
        open={popupVisible}
        onOpenChange={handlePopupVisibleChange}
        placement="bottomRight"
        classNames={{ root: "user-message-dropdown" }}
      >
        <button
          title="用户对话"
          className="flex items-center justify-center rounded-full transition-all"
          style={{
            width: 32,
            height: 32,
            backgroundColor: "var(--ant-color-bg-elevated)",
            border: "1px solid var(--ant-color-border-secondary)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "var(--ant-color-primary)";
            e.currentTarget.style.borderColor = "var(--ant-color-primary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "var(--ant-color-bg-elevated)";
            e.currentTarget.style.borderColor = "var(--ant-color-border-secondary)";
          }}
        >
          <MessageOutlined style={{ fontSize: 14, color: "var(--ant-color-text-secondary)" }} />
        </button>
      </Dropdown>

      <Modal
        title={`用户消息 #${(selectedMessage?.messageIndex ?? 0) + 1}`}
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={[
          <button
            key="jump"
            onClick={() => {
              if (selectedMessage) {
                scrollToMessage(selectedMessage);
                setDetailVisible(false);
              }
            }}
            style={{
              padding: "4px 16px",
              backgroundColor: "var(--ant-color-primary)",
              color: "white",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            跳转到此消息
          </button>,
          <button
            key="close"
            onClick={() => setDetailVisible(false)}
            style={{
              padding: "4px 16px",
              backgroundColor: "transparent",
              color: "var(--ant-color-text-secondary)",
              border: "1px solid var(--ant-color-border)",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            关闭
          </button>,
        ]}
        width={500}
      >
        {selectedMessage && (
          <div className="py-2">
            <div className="text-xs text-[var(--ant-color-text-secondary)] mb-2">
              {new Date(selectedMessage.timestamp).toLocaleString("zh-CN")}
            </div>
            <pre
              className="whitespace-pre-wrap break-all text-sm"
              style={{
                fontFamily: "inherit",
                color: "var(--ant-color-text)",
                maxHeight: 300,
                overflow: "auto",
              }}
            >
              {selectedMessage.text}
            </pre>
          </div>
        )}
      </Modal>
    </>
  );
}
