import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from "react";
import { Terminal, type IBufferRange } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { listen } from "@tauri-apps/api/event";
import { writeToPty, resizePty, readClipboardText, writeClipboardText } from "../../utils/ipc";
import { useAppStore } from "../../stores/appStore";
import { TERMINAL_COLOR_THEMES, DEFAULT_ANSI_COLORS } from "../../types";
import { terminalThemeForAppTheme } from "../../themes";
import { clipboardImageToProtocol, fileToProtocol } from "../../utils/image";
import UserMessageTracker from "./UserMessageTracker";
import "@xterm/xterm/css/xterm.css";

interface TerminalViewProps {
  tabId: string;
  visible?: boolean;
  /**
   * 是否接收键盘输入(写到 PTY)。
   * 共享 PTY 语义：双开时只有 activePane 启用,避免 onData 双写。
   * 非 active 终端仍订阅 pty:output 同步显示,只是不能键入。
   */
  enableInput?: boolean;
}

export interface TerminalViewHandle {
  scrollToLine: (lineIndex: number) => void;
  getCurrentLineIndex: () => number;
  copySelection: () => Promise<boolean>;
  pasteFromClipboard: () => Promise<boolean>;
}

function getThemeColors(themeName: string) {
  const theme = TERMINAL_COLOR_THEMES.find((t) => t.name === themeName);
  const base = theme ? theme.colors : TERMINAL_COLOR_THEMES[0].colors;

  return {
    background: base.background,
    foreground: base.foreground,
    cursor: base.cursor ?? base.foreground,
    selectionBackground: base.selectionBackground ?? "#44444444",
    black: base.black ?? DEFAULT_ANSI_COLORS.black,
    red: base.red ?? DEFAULT_ANSI_COLORS.red,
    green: base.green ?? DEFAULT_ANSI_COLORS.green,
    yellow: base.yellow ?? DEFAULT_ANSI_COLORS.yellow,
    blue: base.blue ?? DEFAULT_ANSI_COLORS.blue,
    magenta: base.magenta ?? DEFAULT_ANSI_COLORS.magenta,
    cyan: base.cyan ?? DEFAULT_ANSI_COLORS.cyan,
    white: base.white ?? DEFAULT_ANSI_COLORS.white,
    brightBlack: base.brightBlack ?? DEFAULT_ANSI_COLORS.brightBlack,
    brightRed: base.brightRed ?? DEFAULT_ANSI_COLORS.brightRed,
    brightGreen: base.brightGreen ?? DEFAULT_ANSI_COLORS.brightGreen,
    brightYellow: base.brightYellow ?? DEFAULT_ANSI_COLORS.brightYellow,
    brightBlue: base.brightBlue ?? DEFAULT_ANSI_COLORS.brightBlue,
    brightMagenta: base.brightMagenta ?? DEFAULT_ANSI_COLORS.brightMagenta,
    brightCyan: base.brightCyan ?? DEFAULT_ANSI_COLORS.brightCyan,
    brightWhite: base.brightWhite ?? DEFAULT_ANSI_COLORS.brightWhite,
    scrollbarSliderBackground: base.foreground + "33",
    scrollbarSliderHoverBackground: base.foreground + "66",
    scrollbarSliderActiveBackground: base.foreground + "99",
  };
}

function sanitizeCursorStyle(style: string): "block" | "bar" | "underline" {
  if (style === "block" || style === "bar" || style === "underline") return style;
  return "block";
}

/**
 * WebKitGTK (Tauri Linux webview) 的 IME composition 行为与 Chromium 不同：
 * 1. 可能不触发 compositionstart 事件，导致 xterm.js 的 _isComposing 始终为 false
 * 2. _compositionPosition.start 始终为 0，_finalizeComposition 读取 substring(0) 获取全部文本
 * 3. textarea.value 在 composition 之间不会被清空，导致累积
 * 4. keydown(keyCode=229) 时 _isComposing 为 false，触发 _handleAnyTextareaChanges 也发送数据
 *
 * 重复机制：_handleAnyTextareaChanges 和 _finalizeComposition 都通过 setTimeout(0) 发送数据
 *
 * 修复策略（monkey-patch CompositionHelper.keydown）：
 * - 当 keyCode=229 且 !_isComposing 时，手动调用 compositionstart() 设置正确的 _compositionPosition
 * - 跳过 _handleAnyTextareaChanges 调用，避免重复发送
 * - capture 模式监听 compositionend，修正 _compositionPosition 后延迟清空 textarea.value
 */
function patchWebKitGtkIme(term: Terminal): (() => void) | undefined {
  const textarea = term.element?.querySelector("textarea") as HTMLTextAreaElement | null;
  if (!textarea) return undefined;

  // 访问 xterm.js 内部的 CompositionHelper（通过 _core 访问 CoreBrowserTerminal）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const compositionHelper = (term as any)._core?._compositionHelper;
  if (!compositionHelper) return undefined;

  // 保存原始 keydown 方法
  const originalKeydown = compositionHelper.keydown.bind(compositionHelper);

  // Monkey-patch keydown：WebKitGTK 不触发 compositionstart 时手动补调
  compositionHelper.keydown = function (ev: KeyboardEvent): boolean {
    if (ev.keyCode === 229 && !this._isComposing && !this._isSendingComposition) {
      this.compositionstart();
    }
    // 调用原始 keydown 逻辑
    return originalKeydown(ev);
  };

  let lastCompositionData = "";

  const onCompositionStart = (_e: CompositionEvent) => {
    // capture 模式监听，确保先于 xterm.js 的 bubble 处理
  };

  const onCompositionUpdate = (e: CompositionEvent) => {
    lastCompositionData = e.data || "";
  };

  const onCompositionEnd = (e: CompositionEvent) => {
    const data = e.data || lastCompositionData;
    if (data) {
      const currentLength = textarea.value.length;
      const startPos = Math.max(0, currentLength - data.length);
      compositionHelper._compositionPosition.start = startPos;
      compositionHelper._compositionPosition.end = currentLength;
    }
    requestAnimationFrame(() => {
      textarea.value = "";
    });
  };

  // capture 模式监听 input 事件，了解 WebKitGTK 的 inputType 行为
  const onInput = (_e: Event) => {
    // capture 先于 xterm.js bubble 执行
  };

  // capture 模式：composition 事件 xterm.js 用 bubble 模式，capture 先执行
  textarea.addEventListener("compositionstart", onCompositionStart, true);
  textarea.addEventListener("compositionupdate", onCompositionUpdate, true);
  textarea.addEventListener("compositionend", onCompositionEnd, true);
  textarea.addEventListener("input", onInput, true);

  return () => {
    compositionHelper.keydown = originalKeydown;
    textarea.removeEventListener("compositionstart", onCompositionStart, true);
    textarea.removeEventListener("compositionupdate", onCompositionUpdate, true);
    textarea.removeEventListener("compositionend", onCompositionEnd, true);
    textarea.removeEventListener("input", onInput, true);
  };
}

function detectImageExtension(mimeType: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
  };
  return map[mimeType] || "png";
}

/**
 * 从 xterm buffer 直接读取选区文本，作为 getSelection() 返回空时的兜底。
 *
 * 为什么需要这个兜底：
 * xterm.js 的 SelectionService.selectionText 是个 getter，每次调用时根据
 * 当前 buffer 状态用 translateBufferLineToString 重新计算文本。
 * 但 SelectionService 内部用 finalSelectionStart/finalSelectionEnd 坐标。
 * 在 Claude Code 高频刷屏场景下，连续写入可能让这些坐标在 getSelection
 * 被调用时处于"无效"状态（例如 start/end 被清空），导致 getter 返回 ""。
 *
 * 直接读 buffer：坐标一旦由 getSelectionPosition 返回就是稳定的 buffer 索引；
 * 用 buffer.getLine(y).translateToString(startCol, endCol) 读这些行/列
 * 范围内的字符，不依赖 SelectionService 内部的 selectionText getter 状态。
 *
 * 坐标语义：IBufferCellPosition 的 x/y 虽然文档标 1-based，实测（以及
 * xterm 内部 selectionText 的实现）都是直接当 0-based buffer 索引使用的，
 * 与 translateToString 的 startColumn/endColumn（0-based，endColumn 独占）
 * 语义一致，所以这里不做偏移换算。
 */
function readSelectionFromBuffer(term: Terminal, range: IBufferRange): string {
  const buffer = term.buffer.active;
  const startX = Math.min(range.start.x, range.end.x);
  const endX = Math.max(range.start.x, range.end.x);
  const startY = Math.min(range.start.y, range.end.y);
  const endY = Math.max(range.start.y, range.end.y);

  const lines: string[] = [];
  for (let y = startY; y <= endY; y++) {
    const line = buffer.getLine(y);
    if (!line) continue;
    if (startY === endY) {
      lines.push(line.translateToString(true, startX, endX));
    } else if (y === startY) {
      lines.push(line.translateToString(true, startX));
    } else if (y === endY) {
      lines.push(line.translateToString(true, 0, endX));
    } else {
      lines.push(line.translateToString(true));
    }
  }
  return lines.join("\n");
}

/**
 * 从当前 xterm 状态抓取选中文本。三级回退：
 * 1. term.getSelection() —— SelectionService 缓存的文本
 * 2. readSelectionFromBuffer —— 用 getSelectionPosition 从 buffer 直接读
 * 3. 都空就返回空串
 */
function captureSelectionText(term: Terminal): string {
  const direct = term.getSelection();
  if (direct) return direct;
  if (!term.hasSelection()) return "";
  const range = term.getSelectionPosition();
  if (!range) return "";
  return readSelectionFromBuffer(term, range);
}

const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(function TerminalView({ tabId, visible = true, enableInput = true }, ref) {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const trackerRef = useRef<{ captureInput: (text: string) => void; flushInput: () => void; handleEnter: () => void } | null>(null);
  // 缓存最近一次的有效选中内容。xterm.js 在右键打开自定义菜单后偶发会清空内部选中状态，
  // 这里用 onSelectionChange 持续记录，可作为 getSelection() 失效时的回退值。
  const cachedSelectionRef = useRef<string>("");

  useImperativeHandle(ref, () => ({
    scrollToLine: (lineIndex: number) => {
      const term = xtermRef.current;
      if (term && lineIndex >= 0 && lineIndex < term.buffer.active.length) {
        term.scrollToLine(lineIndex);
      }
    },
    getCurrentLineIndex: () => {
      const term = xtermRef.current;
      return term ? term.buffer.active.length - 1 : 0;
    },
    copySelection: async () => {
      const term = xtermRef.current;
      if (!term) return false;
      // 优先从 xterm 当前状态抓（getSelection 或 buffer 兜底），失败时回退到事件监听器缓存的最近一次有效选中
      let text = captureSelectionText(term);
      const fromCurrent = !!text;
      if (!text) text = cachedSelectionRef.current;
      const fromCache = !!text && !fromCurrent;
      if (!text) {
        console.debug(
          `[TerminalView.copySelection] no text: live(empty), cache(${cachedSelectionRef.current.length}B, hasSelection=${term.hasSelection()})`,
        );
        return false;
      }
      try {
        await writeClipboardText(text);
        console.debug(
          `[TerminalView.copySelection] OK (${text.length}B, fromCurrent=${fromCurrent}, fromCache=${fromCache})`,
        );
        return true;
      } catch (e) {
        console.debug(`[TerminalView.copySelection] clipboard.writeText failed:`, e);
        return false;
      }
    },
    pasteFromClipboard: async () => {
      // Tauri 2 + WebKitGTK (Linux) 下 navigator.clipboard.readText() 在 webview
      // 沙箱里会被拒（NotAllowedError）。改走 tauri-plugin-clipboard-manager 的
      // Rust 端命令直接读系统剪贴板，绕过 webview 权限限制。
      try {
        const text = await readClipboardText();
        if (text) {
          // 共享 PTY:非 active pane 拒绝写入,避免双开双写
          if (!enableInput) {
            console.debug("[TerminalView.paste] skipped: enableInput=false");
            return false;
          }
          writeToPty(tabId, text).catch(() => {});
          console.debug(`[TerminalView.paste] OK (${text.length}B)`);
          return true;
        }
        console.debug("[TerminalView.paste] readClipboardText returned empty string");
      } catch (e) {
        const err = e as Error;
        console.debug(
          `[TerminalView.paste] readClipboardText threw: ${err?.name || "?"} ${err?.message || String(e)}`,
        );
      }
      return false;
    },
  }), [tabId, enableInput]);

  const terminalSettings = useAppStore((s) => s.terminalSettings);
  const appTheme = useAppStore((s) => s.theme);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches
  );

  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  const effectiveThemeName = terminalSettings.followAppTheme
    ? terminalThemeForAppTheme(appTheme, systemDark)
    : terminalSettings.colorTheme;

  const handleResize = useCallback(() => {
    if (visible && fitAddonRef.current && xtermRef.current) {
      fitAddonRef.current.fit();
      const { cols, rows } = xtermRef.current;
      resizePty(tabId, cols, rows).catch(() => {});
    }
  }, [tabId, visible]);

  // 初始化终端
  useEffect(() => {
    if (!termRef.current) return;

    const term = new Terminal({
      cursorBlink: terminalSettings.cursorBlink,
      cursorStyle: sanitizeCursorStyle(terminalSettings.cursorStyle),
      fontSize: terminalSettings.fontSize,
      fontFamily: `'${terminalSettings.fontFamily}', 'Sarasa Mono SC', 'Noto Sans Mono CJK SC', 'Microsoft YaHei', 'PingFang SC', monospace`,
      lineHeight: Math.max(1, terminalSettings.lineHeight),
      scrollback: terminalSettings.scrollback,
      theme: getThemeColors(effectiveThemeName),
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(termRef.current);

    fitAddon.fit();


    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // 仅在 test-terminal 调试入口中暴露实例与缓存，便于在浏览器中验证复制逻辑
    if (typeof window !== "undefined" && (window as unknown as { __TEST_TERMINAL__?: boolean }).__TEST_TERMINAL__) {
      (window as unknown as { __XTERM_REF__?: unknown }).__XTERM_REF__ = {
        term,
        getCachedSelection: () => cachedSelectionRef.current,
      };
    }

    // 修复 WebKitGTK IME composition 重复输入
    const unpatchIme = patchWebKitGtkIme(term);

    // 图片粘贴支持
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      // 共享 PTY:非 active pane 拒绝写入,避免双开双写
      if (!enableInput) {
        e.preventDefault();
        console.debug("[TerminalView.paste-image] skipped: enableInput=false");
        return;
      }

      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (!blob) continue;
          try {
            const protocol = await clipboardImageToProtocol(blob, {
              name: `pasted-image.${detectImageExtension(blob.type)}`,
            });
            writeToPty(tabId, protocol);
          } catch (err) {
            console.error("[TerminalView] Failed to paste image:", err);
          }
          return;
        }
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file && file.type.startsWith("image/")) {
            e.preventDefault();
            try {
              const protocol = await fileToProtocol(file);
              writeToPty(tabId, protocol);
            } catch (err) {
              console.error("[TerminalView] Failed to paste file as image:", err);
            }
            return;
          }
        }
      }
    };
    termRef.current.addEventListener("paste", handlePaste);

    term.onData((data) => {
      // 共享 PTY:非 active pane 不写 PTY,避免双开双写
      if (!enableInput) return;
      // Track user input for message tracking
      trackerRef.current?.captureInput(data);
      // Detect Enter key (CR = carriage return, LF = line feed)
      if (data === "\r" || data === "\n") {
        trackerRef.current?.handleEnter();
      }
      writeToPty(tabId, data).catch(() => {});
    });

    // 持续记录终端选中内容，作为右键菜单复制时的回退值。
    // 右键打开 Dropdown 时，Ant Design 接管 contextmenu，xterm 的 textarea 失焦
    // 会清空 SelectionService 状态并触发 onSelectionChange(text="")。此时绝不能
    // 清空缓存——否则恰好在用户准备点 Copy 的瞬间失去了回退值。
    // 策略：仅在有非空内容时刷新缓存，空选中视为 "保持上次有效选中"。
    const refreshSelectionCache = (source: string) => {
      const text = captureSelectionText(term);
      if (text && text !== cachedSelectionRef.current) {
        cachedSelectionRef.current = text;
        console.debug(
          `[TerminalView.select] captured via ${source} (${text.length}B)`,
        );
      }
    };

    const selectionDisposable = term.onSelectionChange(() => {
      refreshSelectionCache("onSelectionChange");
    });

    // 在 mouseup 时再抓一次，作为更可靠的快照。
    // 某些场景（Claude Code 的高频 buffer 刷新）下 onSelectionChange 可能在 mousedown/mousemove
    // 期间被空字符串覆盖，但 mouseup 瞬间 selection 尚未被 buffer 更新影响，是用户真实的意图。
    const onMouseUpCaptureSelection = () => refreshSelectionCache("mouseup");
    term.element?.addEventListener("mouseup", onMouseUpCaptureSelection);

    // mousedown 时也抓一次，防止 onSelectionChange 还没触发就被 contextmenu 打断。
    const onMouseDownCaptureSelection = () => refreshSelectionCache("mousedown");
    term.element?.addEventListener("mousedown", onMouseDownCaptureSelection);

    // contextmenu 是右击开菜单的瞬间，是复制之前的最后机会。
    const onContextMenuCaptureSelection = () => refreshSelectionCache("contextmenu");
    term.element?.addEventListener("contextmenu", onContextMenuCaptureSelection);

    // mousemove 在拖拽过程中持续抓，用 rAF 节流避免每像素都跑一次 buffer 读取。
    // 高频 PTY 输出场景下，每次 mousemove 都可能让选区文本变化，这里保留最近一次
    // 非空快照即可，用户释放鼠标前最近一次抓到的内容最接近视觉所见。
    let moveRafId: number | null = null;
    const onMouseMoveCaptureSelection = () => {
      if (moveRafId !== null) return;
      moveRafId = requestAnimationFrame(() => {
        moveRafId = null;
        refreshSelectionCache("mousemove");
      });
    };
    term.element?.addEventListener("mousemove", onMouseMoveCaptureSelection);

    const unlisten_output = listen<{ tabId: string; data: string }>(
      "pty:output",
      (event) => {
        if (event.payload.tabId === tabId) {
          term.write(event.payload.data);
        }
      },
    );

    const unlisten_exit = listen<string>("pty:exit", (event) => {
      if (event.payload === tabId) {
        term.write("\r\n\x1b[33m[进程已退出]\x1b[0m\r\n");
        useAppStore.getState().updateSession(tabId, { isRunning: false });
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    resizeObserver.observe(termRef.current);

    return () => {
      unpatchIme?.();
      termRef.current?.removeEventListener("paste", handlePaste);
      term.element?.removeEventListener("mouseup", onMouseUpCaptureSelection);
      term.element?.removeEventListener("mousedown", onMouseDownCaptureSelection);
      term.element?.removeEventListener("contextmenu", onContextMenuCaptureSelection);
      term.element?.removeEventListener("mousemove", onMouseMoveCaptureSelection);
      if (moveRafId !== null) cancelAnimationFrame(moveRafId);
      resizeObserver.disconnect();
      selectionDisposable.dispose();
      term.dispose();
      unlisten_output.then((fn) => fn());
      unlisten_exit.then((fn) => fn());
    };
  }, [tabId, enableInput]);

  // 设置变更时动态更新终端
  useEffect(() => {
    const term = xtermRef.current;
    if (!term) return;

    const cursorStyleChanged =
      term.options.cursorStyle !== sanitizeCursorStyle(terminalSettings.cursorStyle);
    const cursorBlinkChanged = term.options.cursorBlink !== terminalSettings.cursorBlink;

    term.options.cursorBlink = terminalSettings.cursorBlink;
    term.options.cursorStyle = sanitizeCursorStyle(terminalSettings.cursorStyle);
    term.options.fontSize = terminalSettings.fontSize;
    term.options.fontFamily = `'${terminalSettings.fontFamily}', 'Sarasa Mono SC', 'Noto Sans Mono CJK SC', 'Microsoft YaHei', 'PingFang SC', monospace`;
    term.options.lineHeight = Math.max(1, terminalSettings.lineHeight);
    term.options.scrollback = terminalSettings.scrollback;
    term.options.theme = getThemeColors(effectiveThemeName);

    // cursor 样式/闪烁变化后需要刷新终端以使变更立即生效
    if (cursorStyleChanged || cursorBlinkChanged) {
      term.refresh(0, term.rows - 1);
    }

    // 字体/字号/行高变更后需要重新 fit
    if (fitAddonRef.current) {
      requestAnimationFrame(() => {
        fitAddonRef.current?.fit();
      });
    }
  }, [terminalSettings, effectiveThemeName]);

  // 可见性变更时重新 fit
  useEffect(() => {
    if (visible && fitAddonRef.current && xtermRef.current) {
      requestAnimationFrame(() => {
        fitAddonRef.current?.fit();
        if (xtermRef.current) {
          const { cols, rows } = xtermRef.current;
          resizePty(tabId, cols, rows).catch(() => {});
        }
      });
    }
  }, [visible, tabId]);

  const themeColors = getThemeColors(effectiveThemeName);

  return (
    <div className="w-full h-full relative" style={{ backgroundColor: themeColors.background }}>
      <div
        ref={termRef}
        className="w-full h-full"
        style={{ padding: "4px 8px" }}
      />
      {/* 用户消息追踪器 - 悬浮在右上角 */}
      <div
        className="absolute top-2 right-2 z-10"
        style={{ padding: "4px 8px" }}
      >
        <UserMessageTracker
          tabId={tabId}
          xtermRef={xtermRef}
          trackerRef={trackerRef}
        />
      </div>
    </div>
  );
});

export default TerminalView;
