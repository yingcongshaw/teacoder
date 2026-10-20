import { StrictMode, useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { ConfigProvider, theme as antdTheme } from "antd";
import zhCN from "antd/locale/zh_CN";
import TerminalView, { type TerminalViewHandle } from "./components/terminal/TerminalView";
import { readClipboardText } from "./utils/ipc";
import "./index.css";

// 测试目的：复现 Claude Code 场景下复制失败的 bug。
// Claude Code 使用 Alt 屏幕 + 频繁重绘，可能导致 onSelectionChange 从未被有效文本触发。
// 验证：mouseup 时直接抓 selection 能否解决。

interface LogEntry {
  msg: string;
  kind: "info" | "ok" | "err";
}

interface TestRef {
  term: import("@xterm/xterm").Terminal;
  getCachedSelection: () => string;
}

declare global {
  interface Window {
    __XTERM_REF__?: TestRef;
  }
}

function TestHarness() {
  const handleRef = useRef<TerminalViewHandle | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");

  const append = (msg: string, kind: "info" | "ok" | "err" = "info") => {
    setLog((l) => [...l, { msg, kind }]);
  };

  useEffect(() => {
    const timer = setTimeout(async () => {
      setStatus("running");
      append("[1] Claude Code scenario test started");

      const handle = handleRef.current;
      if (!handle) {
        append("[2] handle not ready", "err");
        setStatus("error");
        return;
      }

      const termRef = window.__XTERM_REF__;
      if (!termRef?.term) {
        append("[3] xterm instance not exposed", "err");
        setStatus("error");
        return;
      }
      const xterm = termRef.term;
      append("[3] xterm ready");

      // === 模拟 Claude Code 启动 ===
      // 1. 切换到 alt 屏幕
      xterm.write("\x1b[?1049h");
      // 2. 清屏
      xterm.write("\x1b[2J");
      // 3. Claude Code 输出 banner
      xterm.write("\x1b[1;1H");
      xterm.write("\x1b[1;36m╭──────────────────────────────────────╮\x1b[0m\r\n");
      xterm.write("\x1b[2;1H");
      xterm.write("\x1b[1;36m│\x1b[0m  \x1b[1mWelcome to Claude Code\x1b[0m            \x1b[1;36m│\x1b[0m\r\n");
      xterm.write("\x1b[3;1H");
      xterm.write("\x1b[1;36m╰──────────────────────────────────────╯\x1b[0m\r\n");
      // 4. 输出一些对话
      xterm.write("\x1b[5;1H");
      xterm.write("\x1b[36m> \x1b[0mPlease help me write a function\r\n");
      xterm.write("\x1b[7;1H");
      xterm.write("I'll help you with that. Let me analyze the code:\r\n");
      xterm.write("Here is a sample implementation in TypeScript:\r\n");
      xterm.write("\r\n");
      xterm.write("\x1b[32mfunction\x1b[0m \x1b[33mgreet\x1b[0m(name: \x1b[32mstring\x1b[0m): \x1b[32mstring\x1b[0m {\r\n");
      xterm.write("  \x1b[32mreturn\x1b[0m \x1b[31m`Hello, \x1b[0m${name}\x1b[31m!`\x1b[0m;\r\n");
      xterm.write("}\r\n");
      xterm.write("\r\n");
      xterm.write("This function takes a name parameter and returns a greeting.\r\n");
      append("[4] Claude Code output simulated");
      await new Promise((r) => setTimeout(r, 100));

      // === 模拟真实用户鼠标拖拽选中 ===
      // 通过 xterm 的 Buffer API 直接定位 cell，构造 mouseup 时机让它捕获 selection
      // 因为 xterm 的真实 selection 需要 canvas 上的真实鼠标坐标，这里用一个折中方案：
      // 通过程序触发 selectAll 然后模拟 Claude Code 在 user 即将 mouseup 时的突发输出
      xterm.selectAll();
      await new Promise((r) => setTimeout(r, 30));

      // 先记录 selectAll 之后的 selection
      const selProgrammatic = xterm.getSelection();
      append(`[5] programmatic selectAll: getSelection()=${selProgrammatic.length}B`);

      // === 模拟 Claude Code 在用户选中期间继续输出（高频 spinner 动画） ===
      // 这正是 Claude Code 真实场景：用户在选中期间，对端一直在输出
      for (let i = 0; i < 3; i++) {
        // spinner 字符序列
        const spinners = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
        xterm.write(`\x1b[${20 + i};1H\x1b[K${spinners[i % spinners.length]} Generating response...`);
        await new Promise((r) => setTimeout(r, 20));
      }

      // 此时 selection 可能被 buffer 改动影响
      const selMidWrite = xterm.getSelection();
      const cacheMidWrite = termRef.getCachedSelection();
      append(`[6] during Claude Code writes: getSelection()=${selMidWrite.length}B, cache=${cacheMidWrite.length}B`);

      // === 用户右键（模拟 rightClickHandler 的 selectionService.clearSelection）===
      const core = (xterm as unknown as { _core: { _selectionService: { clearSelection: () => void } } })._core;
      core._selectionService.clearSelection();
      await new Promise((r) => setTimeout(r, 50));

      const selAfter = xterm.getSelection();
      const cacheAfter = termRef.getCachedSelection();
      append(`[7] after right-click: getSelection()=${selAfter.length}B, cache=${cacheAfter.length}B`);

      if (!cacheAfter) {
        append("    ❌ FAIL — cache was cleared (the bug)", "err");
        setStatus("error");
        return;
      }
      append("    ✅ cache preserved — fallback available", "ok");

      // === 复制 ===
      const ok = await handle.copySelection();
      append(`[8] copySelection() returned: ${ok}`, ok ? "ok" : "err");

      try {
        const text = await readClipboardText();
        append(`[9] clipboard (${text.length}B): <b>${text.slice(0, 60).replace(/\n/g, "↵")}${text.length > 60 ? "…" : ""}</b>`);
        if (text.length > 0) {
          append("[10] ✅ PASS — Claude Code scenario works", "ok");
          setStatus("done");
          return;
        }
      } catch (e) {
        append(`[9] clipboard read failed: ${String(e)}`, "err");
      }

      setStatus("error");
    }, 500);

    return () => clearTimeout(timer);
  }, []);

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{ algorithm: antdTheme.darkAlgorithm }}
    >
      <div
        className="info"
        style={{
          color: "var(--ant-color-text)",
          fontFamily: "monospace",
          fontSize: 12,
        }}
      >
        {log.length === 0 ? "waiting…" : log.map((entry, i) => {
          const color = entry.kind === "ok" ? "#52c41a" : entry.kind === "err" ? "#ff4d4f" : "inherit";
          return (
            <div key={i} style={{ color }}>
              <span dangerouslySetInnerHTML={{ __html: entry.msg }} />
            </div>
          );
        })}
        <div style={{ marginTop: 12, paddingTop: 8, borderTop: "1px solid #333" }}>
          <strong>状态:</strong>{" "}
          <span
            style={{
              color:
                status === "done"
                  ? "#52c41a"
                  : status === "error"
                  ? "#ff4d4f"
                  : "#888",
            }}
          >
            {status}
          </span>
        </div>
      </div>
      <div id="root" style={{ width: 900, height: 500, border: "1px solid #333" }}>
        <TerminalView
          tabId="claude-code-tab"
          visible
          ref={(h) => {
            handleRef.current = h;
          }}
        />
      </div>
    </ConfigProvider>
  );
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("root element missing");
ReactDOM.createRoot(rootEl).render(
  <StrictMode>
    <TestHarness />
  </StrictMode>,
);