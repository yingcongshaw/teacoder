import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { listen } from "@tauri-apps/api/event";
import { writeToPty, resizePty } from "../../utils/ipc";
import { useAppStore } from "../../stores/appStore";
import { TERMINAL_COLOR_THEMES, DEFAULT_ANSI_COLORS } from "../../types";
import { terminalThemeForAppTheme } from "../../themes";
import { clipboardImageToProtocol, fileToProtocol } from "../../utils/image";
import "@xterm/xterm/css/xterm.css";

interface TerminalViewProps {
  tabId: string;
  visible?: boolean;
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

export default function TerminalView({ tabId, visible = true }: TerminalViewProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

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
      fontFamily: `'${terminalSettings.fontFamily}', monospace`,
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

    // 修复 WebKitGTK IME composition 重复输入
    const unpatchIme = patchWebKitGtkIme(term);

    // 图片粘贴支持
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

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
      writeToPty(tabId, data).catch(() => {});
    });

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
      resizeObserver.disconnect();
      term.dispose();
      unlisten_output.then((fn) => fn());
      unlisten_exit.then((fn) => fn());
    };
  }, [tabId]);

  // 设置变更时动态更新终端
  useEffect(() => {
    const term = xtermRef.current;
    if (!term) return;

    term.options.cursorBlink = terminalSettings.cursorBlink;
    term.options.cursorStyle = sanitizeCursorStyle(terminalSettings.cursorStyle);
    term.options.fontSize = terminalSettings.fontSize;
    term.options.fontFamily = `'${terminalSettings.fontFamily}', monospace`;
    term.options.lineHeight = Math.max(1, terminalSettings.lineHeight);
    term.options.scrollback = terminalSettings.scrollback;
    term.options.theme = getThemeColors(effectiveThemeName);

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
    <div
      ref={termRef}
      className="w-full h-full"
      style={{ padding: "4px 8px", backgroundColor: themeColors.background }}
    />
  );
}
