import { describe, test, expect, beforeEach, vi } from "vitest";

// appStore 依赖 Tauri 的 invoke,测试环境没有 IPC 通道。
// mock 整层 ipc,让 store 的纯状态逻辑可被独立验证。
const ipcState = {
  sessions: [] as unknown[],
  projects: [] as unknown[],
  // 让 claudeJsonlExists 异步返回,复现真实环境里 openTab 的 await 中断点
  jsonlDelayMs: 0,
};

vi.mock("../../utils/ipc", () => ({
  stopSession: vi.fn(async () => {}),
  startSession: vi.fn(async () => {}),
  projectList: vi.fn(async () => ipcState.projects),
  projectCreate: vi.fn(async () => ({})),
  projectUpdate: vi.fn(async () => ({})),
  projectDelete: vi.fn(async () => {}),
  projectReorder: vi.fn(async () => {}),
  devEnvironmentList: vi.fn(async () => []),
  sessionList: vi.fn(async () => ipcState.sessions),
  sessionCreate: vi.fn(async () => ({})),
  sessionUpdate: vi.fn(async () => {}),
  sessionDelete: vi.fn(async () => {}),
  sessionReorder: vi.fn(async () => {}),
  categoryList: vi.fn(async () => []),
  categoryCreate: vi.fn(async () => ({})),
  categoryUpdate: vi.fn(async () => ({})),
  categoryDelete: vi.fn(async () => {}),
  categoryReorder: vi.fn(async () => {}),
  claudeJsonlExists: vi.fn(async () => {
    if (ipcState.jsonlDelayMs > 0) {
      await new Promise((r) => setTimeout(r, ipcState.jsonlDelayMs));
    }
    return true;
  }),
  listLlmProviders: vi.fn(async () => []),
  createLlmProvider: vi.fn(async () => ({})),
  updateLlmProvider: vi.fn(async () => ({})),
  deleteLlmProvider: vi.fn(async () => {}),
}));

import { useAppStore } from "../appStore";
import { stopSession } from "../../utils/ipc";

const PANES_KEY = "teacoder_panes_layout";

function makeSession(id: string, isRunning = false) {
  return {
    id,
    name: id,
    toolType: "claude",
    // 有 cliSessionId 才会走 openTab 里的 claudeJsonlExists await 分支，
    // 这是真实环境（Claude Code 会话）的常态
    cliSessionId: `${id}-cli`,
    projectId: "p-project",
    profileId: "",
    cliArgs: "[]",
    envVars: "",
    isRunning,
    createdAt: 0,
    updatedAt: 0,
  };
}

/** 等待所有 pending 的 openTab 异步体跑完 */
async function flush() {
  for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(r, 0));
}

function seedLayout(panes: { id: string; openTabIds: string[]; activeTabId: string }[]) {
  localStorage.setItem(
    PANES_KEY,
    JSON.stringify({ version: 2, panes, activePaneId: panes[0]?.id ?? null }),
  );
}

describe("restoreTabs — 分屏布局恢复", () => {
  beforeEach(() => {
    localStorage.clear();
    ipcState.sessions = [];
    ipcState.projects = [];
    ipcState.jsonlDelayMs = 0;
    useAppStore.setState({
      sessions: [],
      projects: [],
      panes: [],
      openTabIds: [],
      activeTabId: null,
      activePaneId: null,
    } as never);
  });

  test("两个 pane 各一个 tab，重开后应恢复为两栏", async () => {
    ipcState.sessions = [makeSession("tab-a"), makeSession("tab-b")];
    useAppStore.setState({ sessions: ipcState.sessions } as never);
    seedLayout([
      { id: "pane-left", openTabIds: ["tab-a"], activeTabId: "tab-a" },
      { id: "pane-right", openTabIds: ["tab-b"], activeTabId: "tab-b" },
    ]);

    useAppStore.getState().restoreTabs();
    await flush();

    const panes = useAppStore.getState().panes;
    expect(panes.length, `实际恢复 ${JSON.stringify(panes)}`).toBe(2);
    expect(panes.map((p) => p.openTabIds)).toEqual([["tab-a"], ["tab-b"]]);
  });

  test("同一个 tab 在两个 pane 双开，重开后应恢复为两栏", async () => {
    ipcState.sessions = [makeSession("tab-a")];
    useAppStore.setState({ sessions: ipcState.sessions } as never);
    seedLayout([
      { id: "pane-left", openTabIds: ["tab-a"], activeTabId: "tab-a" },
      { id: "pane-right", openTabIds: ["tab-a"], activeTabId: "tab-a" },
    ]);

    useAppStore.getState().restoreTabs();
    await flush();

    const panes = useAppStore.getState().panes;
    expect(panes.length, `实际恢复 ${JSON.stringify(panes)}`).toBe(2);
  });

  test("claude 预检有延迟时（真实 IPC 场景），布局同样应恢复为两栏", async () => {
    ipcState.sessions = [makeSession("tab-a"), makeSession("tab-b")];
    ipcState.jsonlDelayMs = 5;
    useAppStore.setState({ sessions: ipcState.sessions } as never);
    seedLayout([
      { id: "pane-left", openTabIds: ["tab-a"], activeTabId: "tab-a" },
      { id: "pane-right", openTabIds: ["tab-b"], activeTabId: "tab-b" },
    ]);

    useAppStore.getState().restoreTabs();
    await flush();

    const panes = useAppStore.getState().panes;
    expect(panes.length, `实际恢复 ${JSON.stringify(panes)}`).toBe(2);
  });

  test("恢复后持久化的布局应仍是两栏（供下次启动使用）", async () => {
    ipcState.sessions = [makeSession("tab-a"), makeSession("tab-b")];
    useAppStore.setState({ sessions: ipcState.sessions } as never);
    seedLayout([
      { id: "pane-left", openTabIds: ["tab-a"], activeTabId: "tab-a" },
      { id: "pane-right", openTabIds: ["tab-b"], activeTabId: "tab-b" },
    ]);

    useAppStore.getState().restoreTabs();
    await flush();

    const persisted = JSON.parse(localStorage.getItem(PANES_KEY)!);
    expect(persisted.panes.length).toBe(2);
  });
});

describe("closeTab — 共享会话在两边分屏双开", () => {
  beforeEach(() => {
    localStorage.clear();
    ipcState.sessions = [];
    ipcState.projects = [];
    ipcState.jsonlDelayMs = 0;
    vi.mocked(stopSession).mockClear();
    useAppStore.setState({
      sessions: [],
      projects: [],
      panes: [],
      openTabIds: [],
      activeTabId: null,
      activePaneId: null,
    } as never);
  });

  test("关掉一边的实例，另一边仍保留，且不停 PTY", () => {
    ipcState.sessions = [makeSession("tab-a")];
    useAppStore.setState({
      sessions: ipcState.sessions,
      panes: [
        { id: "pane-left", openTabIds: ["tab-a"], activeTabId: "tab-a" },
        { id: "pane-right", openTabIds: ["tab-a"], activeTabId: "tab-a" },
      ],
      activePaneId: "pane-left",
    } as never);

    useAppStore.getState().closeTab("tab-a", "pane-left");

    const panes = useAppStore.getState().panes;
    expect(panes.map((p) => p.openTabIds)).toEqual([["tab-a"]]);
    expect(stopSession, "还有一边开着,不该停 PTY").not.toHaveBeenCalled();
  });

  test("最后一个实例关闭时才停 PTY", () => {
    ipcState.sessions = [makeSession("tab-a", true)];
    useAppStore.setState({
      sessions: ipcState.sessions,
      panes: [
        { id: "pane-left", openTabIds: ["tab-a"], activeTabId: "tab-a" },
        { id: "pane-right", openTabIds: ["tab-a"], activeTabId: "tab-a" },
      ],
      activePaneId: "pane-left",
    } as never);

    useAppStore.getState().closeTab("tab-a", "pane-left");
    expect(stopSession).not.toHaveBeenCalled();

    useAppStore.getState().closeTab("tab-a", "pane-right");

    expect(useAppStore.getState().panes).toEqual([]);
    expect(stopSession).toHaveBeenCalledWith("tab-a");
  });
});

describe("closeOtherTabs — 分屏下不应波及其它面板", () => {
  beforeEach(() => {
    localStorage.clear();
    ipcState.sessions = [];
    ipcState.projects = [];
    ipcState.jsonlDelayMs = 0;
    vi.mocked(stopSession).mockClear();
    useAppStore.setState({
      sessions: [],
      projects: [],
      panes: [],
      openTabIds: [],
      activeTabId: null,
      activePaneId: null,
    } as never);
  });

  test("只清本面板的其它标签，另一面板原样保留", () => {
    ipcState.sessions = [makeSession("tab-a"), makeSession("tab-b")];
    useAppStore.setState({
      sessions: ipcState.sessions,
      panes: [
        { id: "pane-left", openTabIds: ["tab-a", "tab-b"], activeTabId: "tab-b" },
        { id: "pane-right", openTabIds: ["tab-a"], activeTabId: "tab-a" },
      ],
      activePaneId: "pane-left",
    } as never);

    useAppStore.getState().closeOtherTabs("tab-b", "pane-left");

    const panes = useAppStore.getState().panes;
    expect(panes.map((p) => p.openTabIds)).toEqual([["tab-b"], ["tab-a"]]);
    expect(stopSession, "tab-a 在右面板还开着,不该停它的 PTY").not.toHaveBeenCalled();
  });

  test("同一会话双开时点「关闭其他标签」，不停共享 PTY", () => {
    ipcState.sessions = [makeSession("tab-a", true)];
    useAppStore.setState({
      sessions: ipcState.sessions,
      panes: [
        { id: "pane-left", openTabIds: ["tab-a"], activeTabId: "tab-a" },
        { id: "pane-right", openTabIds: ["tab-a"], activeTabId: "tab-a" },
      ],
      activePaneId: "pane-left",
    } as never);

    useAppStore.getState().closeOtherTabs("tab-a", "pane-left");

    expect(useAppStore.getState().panes.map((p) => p.openTabIds)).toEqual([["tab-a"], ["tab-a"]]);
    expect(stopSession, "另一面板还开着这个会话,不该停 PTY").not.toHaveBeenCalled();
  });

  test("本面板其它标签在别处还开着时，不停它的 PTY", () => {
    ipcState.sessions = [makeSession("tab-a", true), makeSession("tab-b", true)];
    useAppStore.setState({
      sessions: ipcState.sessions,
      panes: [
        { id: "pane-left", openTabIds: ["tab-a", "tab-b"], activeTabId: "tab-a" },
        { id: "pane-right", openTabIds: ["tab-b"], activeTabId: "tab-b" },
      ],
      activePaneId: "pane-left",
    } as never);

    useAppStore.getState().closeOtherTabs("tab-a", "pane-left");

    expect(useAppStore.getState().panes.map((p) => p.openTabIds)).toEqual([["tab-a"], ["tab-b"]]);
    expect(stopSession, "tab-b 在右面板还开着,不该停它的 PTY").not.toHaveBeenCalled();
  });
});

describe("openTab — 并发打开时的 pane 归属", () => {
  beforeEach(() => {
    localStorage.clear();
    ipcState.sessions = [];
    ipcState.projects = [];
    ipcState.jsonlDelayMs = 0;
    useAppStore.setState({
      sessions: [],
      projects: [],
      panes: [],
      openTabIds: [],
      activeTabId: null,
      activePaneId: null,
    } as never);
  });

  test("await 期间 activePaneId 被改，目标 pane 仍应是调用时的那个", async () => {
    ipcState.sessions = [makeSession("tab-a"), makeSession("tab-b")];
    ipcState.jsonlDelayMs = 5;
    useAppStore.setState({ sessions: ipcState.sessions } as never);

    // 用户在左 pane 点击 tab-a，随后焦点切到右 pane，再点 tab-b。
    // 两个 openTab 的 await 会在同一时刻恢复，tab-a 仍应落在左 pane。
    useAppStore.setState({
      panes: [
        { id: "pane-left", openTabIds: [], activeTabId: null },
        { id: "pane-right", openTabIds: [], activeTabId: null },
      ],
      activePaneId: "pane-left",
    } as never);

    const first = useAppStore.getState().openTab("tab-a");
    useAppStore.setState({ activePaneId: "pane-right" } as never);
    const second = useAppStore.getState().openTab("tab-b");
    await Promise.all([first, second]);
    await flush();

    const panes = useAppStore.getState().panes;
    expect(panes.map((p) => p.openTabIds)).toEqual([["tab-a"], ["tab-b"]]);
  });
});
