import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { listen } from "@tauri-apps/api/event";
import { writeToPty, resizePty } from "../../utils/ipc";
import { useAppStore } from "../../stores/appStore";
import { TERMINAL_COLOR_THEMES } from "../../types";
import "@xterm/xterm/css/xterm.css";

interface TerminalViewProps {
  tabId: string;
  visible?: boolean;
}

function getThemeColors(themeName: string) {
  const theme = TERMINAL_COLOR_THEMES.find((t) => t.name === themeName);
  return theme ? theme.colors : TERMINAL_COLOR_THEMES[0].colors;
}

function sanitizeCursorStyle(style: string): "block" | "bar" | "underline" {
  if (style === "block" || style === "bar" || style === "underline") return style;
  return "block";
}

export default function TerminalView({ tabId, visible = true }: TerminalViewProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const terminalSettings = useAppStore((s) => s.terminalSettings);

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
      lineHeight: terminalSettings.lineHeight,
      scrollback: terminalSettings.scrollback,
      theme: getThemeColors(terminalSettings.colorTheme),
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(termRef.current);

    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

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
    term.options.lineHeight = terminalSettings.lineHeight;
    term.options.scrollback = terminalSettings.scrollback;
    term.options.theme = getThemeColors(terminalSettings.colorTheme);

    // 字体/字号/行高变更后需要重新 fit
    if (fitAddonRef.current) {
      requestAnimationFrame(() => {
        fitAddonRef.current?.fit();
      });
    }
  }, [terminalSettings]);

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

  const themeColors = getThemeColors(terminalSettings.colorTheme);

  return (
    <div
      ref={termRef}
      className="w-full h-full"
      style={{ padding: "4px 8px", backgroundColor: themeColors.background }}
    />
  );
}
