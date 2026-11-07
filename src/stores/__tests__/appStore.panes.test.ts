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

const PANES_KEY = "teacoder_panes_layout";

function makeSession(id: string) {
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
    isRunning: false,
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
