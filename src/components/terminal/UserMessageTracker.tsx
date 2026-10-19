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
    // 普通按键(含 ASCII 字符):xterm 的 onKey 派发,e.key 已是 DOM 逻辑按键
    captureKey: (key: string) => void;
    // IME 上屏字符(中文/日文等):xterm 不为 IME 派发 onKey,
    // 由 TerminalView 监听 textarea 的 input 事件 + compositionend 标记后转发
    captureImeText: (text: string) => void;
    flushInput: () => void;
    handleEnter: () => void;
  } | null>;
}

// DOM KeyboardEvent.key 中属于"控制/导航/功能键"的集合。
// 这些键不应进入消息内容,只有可打印字符(含 IME 上屏的中文)和 Enter 会改变捕捉状态。
const CONTROL_KEYS = new Set([
  "Backspace", "Tab", "Escape", "Delete", "Insert",
  "CapsLock", "NumLock", "ScrollLock", "Pause",
  "Shift", "Control", "Alt", "AltGraph", "Meta", "OS",
  "ContextMenu", "Print", "PrintScreen",
  "PageUp", "PageDown", "Home", "End",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
]);

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

  // 清理文本中的转义序列残留
  // captureKey 接收的是 DOM KeyboardEvent.key 的字符串,本身不含 ESC 字节,
  // 但历史消息可能从旧路径写入,这里做一次规范化(去除控制字符和 Unicode 替代字符)。
  const cleanMessage = (text: string): string => {
    if (!text) return "";
    return text
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")  // 控制字符
      .replace(/�/g, "")                                  // Unicode 替代字符
      .trim();
  };

  const flushInput = useCallback(() => {
    const input = pendingInputRef.current;
    const cleaned = cleanMessage(input);
    pendingInputRef.current = "";
    if (cleaned) {
      handleMessageSend(cleaned);
    }
  }, [handleMessageSend]);

  // 处理 Enter 键时,确保所有字节都已到达
  const handleFlushWithDelay = useCallback(() => {
    // 延迟 50ms 确保 IME/输入法完成组合
    setTimeout(() => {
      flushInput();
    }, 50);
  }, [flushInput]);

  const handleEnter = useCallback(() => {
    // 延迟 flush 确保 IME/输入法完成组合(如 emoji)
    handleFlushWithDelay();
  }, [handleFlushWithDelay]);

  // 接收 xterm 的 onKey 派发的普通按键(DOM KeyboardEvent.key 字符串)。
  // IME 上屏字符不走 onKey,所以走 captureImeText 路径。
  const captureKey = useCallback((key: string) => {
    if (!key) return;

    if (key === "Enter") {
      // 延迟 flush,给浏览器/IME 一帧时间把上一字符叠加上屏
      setTimeout(() => flushInput(), 50);
      return;
    }

    // 控制/功能键过滤
    if (CONTROL_KEYS.has(key)) return;
    if (/^F\d{1,2}$/.test(key)) return; // F1..F12

    pendingInputRef.current += key;
  }, [flushInput]);

  // 接收 IME 上屏字符(由 TerminalView 在 textarea input 事件 +
  // compositionend 标记检测后转发)。
  // 关键:不在 onKey 路径上派发,以避开 onData 派发顺序错位问题。
  const captureImeText = useCallback((text: string) => {
    if (!text) return;
    // IME 上屏字符串不应包含 ESC/控制字符,但为防御性保留过滤
    const clean = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F�]/g, "");
    if (clean) pendingInputRef.current += clean;
  }, []);

  useEffect(() => {
    if (trackerRef) {
      trackerRef.current = {
        captureKey,
        captureImeText,
        flushInput,
        handleEnter,
      };
    }
  }, [trackerRef, captureKey, captureImeText, flushInput, handleEnter]);

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
