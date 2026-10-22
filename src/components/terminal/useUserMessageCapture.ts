import { useCallback, useEffect, useRef } from "react";
import { message } from "antd";
import type { Terminal } from "@xterm/xterm";
import { listen } from "@tauri-apps/api/event";
import { sessionMessageCreate } from "../../utils/ipc";

export interface UserMessageCaptureHandle {
  // 普通按键(含 ASCII 字符):xterm 的 onKey 派发
  captureKey: (key: string) => void;
  // IME 上屏字符(中文/日文等):xterm 不为 IME 派发 onKey,
  // 由 TerminalView 监听 textarea 的 input 事件 + compositionend 标记后转发
  captureImeText: (text: string) => void;
  flushInput: () => void;
}

export interface UserMessageCaptureOptions {
  tabId: string;
  xtermRef: React.RefObject<Terminal | null>;
  trackerRef: React.MutableRefObject<UserMessageCaptureHandle | null>;
}

// xterm.js 6.x 的 onKey 派发的 e.key 来自 _keyDown 中 evaluateEscapeSequence 结果,
// 不是 DOM KeyboardEvent.key:
//   - Enter           -> "\r" (b.CR)
//   - Backspace       -> "\x7f" (DEL) 或 "\b"
//   - Ctrl+C          -> "\x03" (b.ETX)
//   - 方向键          -> "\x1b[A/B/C/D" 等转义序列
//   - 可打印 ASCII    -> 字符本身("a", "A"、"0" 等)
// 因此过滤"控制键"要按字节判断,不能拿 DOM 字符串名比对。
//
// 单独保留 DOM 字符串名集合只为 IME 走 DOM 事件时的键盘名检查,平时不依赖。
// 注意:Backspace / Delete 由 inspectControlKey 单独识别,这里不放。
const CONTROL_KEYS_DOM = new Set([
  "Tab", "Escape", "Insert",
  "CapsLock", "NumLock", "ScrollLock", "Pause",
  "Shift", "Control", "Alt", "AltGraph", "Meta", "OS",
  "ContextMenu", "Print", "PrintScreen",
  "PageUp", "PageDown", "Home", "End",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "Enter", "Return",
]);

// xterm 派发的控制字节判定。返回值约定:
//   - true:此键是控制键,直接丢弃(转义序列、其他控制字符)
//   - "backspace":此键是 Backspace/DEL/Delete,需要弹出缓冲区末尾字符
//   - false:可打印字符,交给 captureKey 累积
type ControlKeyResult = boolean | "backspace";

function inspectControlKey(key: string): ControlKeyResult {
  if (!key) return true;
  // Delete 键(forward delete):xterm 输出 "\x1b[3~",DOM 字符串为 "Delete"。
  // 在终端纯逐字追加输入的典型场景下,Delete 与 Backspace 等价(都从末尾 pop)。
  if (key === "\x1b[3~" || key === "Delete") return "backspace";
  const code = key.charCodeAt(0);
  // ESC 起头的转义序列(方向键、F1-F12 等)
  if (code === 0x1b) return true;
  // 其他控制字符(除 CR/LF/Tab 之外):后者是有意义字符
  if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return true;
  // DEL (\x7f) 或 Backspace (\b):视为"删除前一字符"
  if (code === 0x7f || code === 0x08) return "backspace";
  return false;
}

// 从缓冲区末尾删一个"用户可见字符",正确处理 UTF-16 代理对
// (emoji / 扩展汉字是两个 code unit)、以及 VS16 等组合修饰符。
function popLastGrapheme(buf: string): string {
  if (!buf) return buf;
  // 先把尾部 \r\n / \n / \r 这种纯控制尾巴去掉,避免误删。
  let end = buf.length;
  const last = buf.charCodeAt(end - 1);
  if (last >= 0xdc00 && last <= 0xdfff && end >= 2) {
    const prev = buf.charCodeAt(end - 2);
    if (prev >= 0xd800 && prev <= 0xdbff) {
      end -= 2;
      return buf.slice(0, end);
    }
  }
  // 处理尾部组合修饰符 / 变体选择符 (0xFE00-0xFE0F、0x200D ZWJ 等),
  // 简单地往后扫一两个 code unit。
  if (last >= 0xfe00 && last <= 0xfe0f) {
    return buf.slice(0, end - 1);
  }
  if (last === 0x200d) {
    return buf.slice(0, end - 1);
  }
  end -= 1;
  return buf.slice(0, end);
}

// 去除控制字符与 Unicode 替代字符。
// captureKey 收到的是 xterm 的 escape 序列 key 字符串,本身不含 ESC 字节,
// 但历史数据可能从旧路径写入,这里做一次规范化。
function cleanMessage(text: string): string {
  if (!text) return "";
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/�/g, "")
    .trim();
}

/**
 * 用户输入捕获:把终端里逐字输入的内容按行落库。
 *
 * 追踪面板已移除(与"会话记录"面板功能重叠),但数据层必须保留——
 * 会话统计、消息检索等功能都依赖这些落库记录,因此拆成 hook 由 TerminalView 直接调用。
 */
export function useUserMessageCapture({
  tabId,
  xtermRef,
  trackerRef,
}: UserMessageCaptureOptions): void {
  const pendingInputRef = useRef<string>("");

  // 敏感输入抑制:
  //   sensitivePendingRef —— 下一次 Enter-flush 是否应被吞掉
  //   sensitiveTimeoutRef —— 30s 后自动解除武装,防止 armed 状态长期挂起后误吞
  // 设计:后端 PtyManager 在 PTY 输出流上识别常见密码提示串(sudo / ssh passphrase /
  //      MySQL "Enter password:" 等),命中后 emit "pty:sensitive_prompt_detected"。
  //      我们订阅该事件并只吞"提示后的下一次"输入,避免级联误伤。
  const sensitivePendingRef = useRef(false);
  const sensitiveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (sensitiveTimeoutRef.current) {
        clearTimeout(sensitiveTimeoutRef.current);
        sensitiveTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!tabId) return;
    const unlisten = listen<{ tabId: string }>("pty:sensitive_prompt_detected", (e) => {
      if (e.payload.tabId !== tabId) return;
      sensitivePendingRef.current = true;
      if (sensitiveTimeoutRef.current) clearTimeout(sensitiveTimeoutRef.current);
      sensitiveTimeoutRef.current = setTimeout(() => {
        sensitivePendingRef.current = false;
        sensitiveTimeoutRef.current = null;
      }, 30_000);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [tabId]);

  const flushInput = useCallback(() => {
    const input = pendingInputRef.current;
    const cleaned = cleanMessage(input);
    pendingInputRef.current = "";

    // 敏感输入抑制:若刚被后端告知有密码提示,清空本行内容并直接吞回,不持久化。
    // 同步清除 ref(不延后),避免双 Enter 路径下重复判定。
    if (sensitivePendingRef.current) {
      sensitivePendingRef.current = false;
      if (sensitiveTimeoutRef.current) {
        clearTimeout(sensitiveTimeoutRef.current);
        sensitiveTimeoutRef.current = null;
      }
      message.info("已识别密码输入，该行未记录");
      return;
    }
    if (!cleaned) return;

    const term = xtermRef.current;
    void sessionMessageCreate({
      sessionId: tabId,
      content: cleaned,
      lineIndex: term ? term.buffer.active.cursorY : 0,
    }).catch(() => {
      // 落库失败无处可提示(追踪面板已移除),仅放弃该行,不打断终端输入。
    });
  }, [tabId, xtermRef]);

  // 接收 xterm 的 onKey 派发的按键(xterm 内 escape 序列化的 key 字符串,
  // 如 "a"、"A"、"\\r"、"\\x1b[A")。IME 上屏字符不走 onKey,
  // 由 TerminalView 在 textarea input + compositionend 标记后转发到 captureImeText。
  const captureKey = useCallback(
    (key: string) => {
      if (!key) return;

      // Enter 检测:xterm 把 Enter 编码为 "\\r"(CR),部分应用可能送 "\\n"(LF)。
      if (key === "\r" || key === "\n") {
        // 延迟 flush,给浏览器/IME 一帧时间把上一字符叠加上屏
        setTimeout(() => flushInput(), 50);
        return;
      }

      const controlResult = inspectControlKey(key);
      if (controlResult === "backspace") {
        pendingInputRef.current = popLastGrapheme(pendingInputRef.current);
        return;
      }
      if (controlResult === true) return;
      // 单独的 DOM 字符串名判断(保留以兼容 IME 走 DOM 事件的分支)
      if (CONTROL_KEYS_DOM.has(key)) return;
      // F1..F12 也按转义序列过滤掉
      if (/^F\d{1,2}$/.test(key)) return;

      pendingInputRef.current += key;
    },
    [flushInput],
  );

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
    trackerRef.current = { captureKey, captureImeText, flushInput };
    return () => {
      trackerRef.current = null;
    };
  }, [trackerRef, captureKey, captureImeText, flushInput]);
}