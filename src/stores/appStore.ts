import { create } from "zustand";
import type {
  CliTool,
  Pane,
  Profile,
  TerminalSettings,
  Project,
  Session,
  SessionTemplate,
  SessionCategory,
  LlmProvider,
  CreateLlmProviderInput,
  UpdateLlmProviderInput,
} from "../types";
import { DEFAULT_TERMINAL_SETTINGS, BUILTIN_SESSION_TEMPLATES } from "../types";
import {
  stopSession,
  startSession,
  projectList,
  projectCreate,
  projectUpdate,
  projectDelete,
  sessionList,
  sessionCreate,
  sessionUpdate,
  sessionDelete,
  categoryList,
  categoryCreate,
  categoryUpdate,
  categoryDelete,
  findLatestClaudeSession,
  listLlmProviders,
  createLlmProvider as createLlmProviderIpc,
  updateLlmProvider as updateLlmProviderIpc,
  deleteLlmProvider as deleteLlmProviderIpc,
} from "../utils/ipc";
import { parseClaudeModels, serializeClaudeModels } from "../utils/claudeModels";

const OPEN_TABS_KEY = "teacoder_open_tabs";
const TERMINAL_SETTINGS_KEY = "teacoder_terminal_settings";
const QUICK_COMMANDS_KEY = "teacoder_quick_commands";
const SPLIT_RATIO_KEY = "teacoder_split_ratio";

function loadOpenTabIds(): string[] {
  try {
    const raw = localStorage.getItem(OPEN_TABS_KEY);
    if (raw) return JSON.parse(raw);
    return [];
  } catch {
    return [];
  }
}

function saveOpenTabIds(ids: string[]) {
  try {
    localStorage.setItem(OPEN_TABS_KEY, JSON.stringify(ids));
  } catch {
    // non-critical
  }
}

function loadSplitRatio(): number {
  try {
    const raw = localStorage.getItem(SPLIT_RATIO_KEY);
    const v = raw ? parseFloat(raw) : NaN;
    if (Number.isFinite(v) && v >= 0.2 && v <= 0.8) return v;
  } catch {
    // ignore
  }
  return 0.5;
}

function saveSplitRatio(ratio: number) {
  try {
    localStorage.setItem(SPLIT_RATIO_KEY, String(ratio));
  } catch {
    // non-critical
  }
}

// 把 panes 拍平为全局 openTabIds 视图：所有 pane 的 openTabIds 的并集，按首次出现顺序去重。
// 保留旧接口的兼容性，让 AppSidebar 等组件继续按"全局已打开"判断。
function flattenPaneOpenIds(panes: Pane[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of panes) {
    for (const id of p.openTabIds) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  return out;
}

function paneActiveId(panes: Pane[], paneId: string | null): string | null {
  if (!paneId) return null;
  return panes.find((p) => p.id === paneId)?.activeTabId ?? null;
}

function loadTerminalSettings(): TerminalSettings {
  try {
    const raw = localStorage.getItem(TERMINAL_SETTINGS_KEY);
    const saved = raw ? JSON.parse(raw) : {};
    const merged = { ...DEFAULT_TERMINAL_SETTINGS, ...saved };
    if (merged.cursorStyle !== "block" && merged.cursorStyle !== "bar" && merged.cursorStyle !== "underline") {
      merged.cursorStyle = DEFAULT_TERMINAL_SETTINGS.cursorStyle;
    }
    return merged;
  } catch {
    return DEFAULT_TERMINAL_SETTINGS;
  }
}

function saveTerminalSettings(settings: TerminalSettings) {
  try {
    localStorage.setItem(TERMINAL_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // non-critical
  }
}

function loadQuickCommands(): Record<string, string> {
  try {
    const saved = localStorage.getItem(QUICK_COMMANDS_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

function saveQuickCommands(map: Record<string, string>) {
  try {
    localStorage.setItem(QUICK_COMMANDS_KEY, JSON.stringify(map));
  } catch {
    // non-critical
  }
}

const GENERAL_SETTINGS_KEY = "teacoder_general_settings";

function loadAppTheme(): string {
  try {
    const raw = localStorage.getItem(GENERAL_SETTINGS_KEY);
    const saved = raw ? JSON.parse(raw) : {};
    return typeof saved.theme === "string" ? saved.theme : "warm-light";
  } catch {
    return "warm-light";
  }
}

function persistGeneralSetting(key: string, value: unknown) {
  try {
    const raw = localStorage.getItem(GENERAL_SETTINGS_KEY);
    const saved = raw ? JSON.parse(raw) : {};
    saved[key] = value;
    localStorage.setItem(GENERAL_SETTINGS_KEY, JSON.stringify(saved));
  } catch {
    // non-critical
  }
}

interface AppState {
  cliTools: CliTool[];
  setCliTools: (tools: CliTool[]) => void;

  // 项目列表（从后端加载）
  projects: Project[];
  loadProjects: () => Promise<void>;
  createProject: (name: string, path: string, color?: string) => Promise<Project>;
  updateProject: (id: string, updates: { name?: string; color?: string }) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;

  // 会话列表（从后端加载，替换旧的 sessions: TabState[]）
  sessions: Session[];
  loadSessions: () => Promise<void>;
  createSession: (input: {
    projectId: string;
    toolType: string;
    title?: string;
    profileId?: string;
    color?: string;
    thinkingIntensity?: string;
    templateId?: string;
    cliArgs?: string;
    envVars?: string;
    categoryId?: string;
    llmProviderId?: string;
    modelName?: string;
    claudeModels?: {
      sonnet?: string;
      opus?: string;
      haiku?: string;
      fable?: string;
      subagent?: string;
      sonnet1M?: boolean;
      opus1M?: boolean;
      haiku1M?: boolean;
      fable1M?: boolean;
      subagent1M?: boolean;
    };
  }) => Promise<Session>;
  updateSession: (id: string, updates: Partial<Session>) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;

  // 会话分类
  categories: SessionCategory[];
  loadCategories: () => Promise<void>;
  createCategory: (input: {
    projectId: string;
    name: string;
    color?: string;
    sortOrder?: number;
  }) => Promise<SessionCategory>;
  updateCategory: (id: string, updates: {
    name?: string;
    color?: string;
    sortOrder?: number;
  }) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;

  // 折叠的分类 ID 列表
  collapsedCategoryIds: string[];
  toggleCategoryCollapsed: (id: string) => void;

  // 已打开标签 ID 列表
  openTabIds: string[];
  activeTabId: string | null;

  // 分屏面板（v0.1 最多 2 个）。panes 是 source of truth，openTabIds/activeTabId
  // 是由 panes 派生的扁平视图，保留旧字段以兼容 AppSidebar、AppHeader、AppStatusBar 等。
  panes: Pane[];
  activePaneId: string | null;
  splitRatio: number;

  setActivePane: (paneId: string) => void;
  splitPane: (tabId: string, direction: "left" | "right") => void;
  closePane: (paneId: string) => void;
  setSplitRatio: (ratio: number) => void;

  closeTab: (id: string) => void;
  openTab: (id: string) => void;
  restoreTabs: () => void;
  closeAllTabs: () => void;
  setActiveTab: (id: string | null) => void;
  duplicateSession: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  closeTabsToRight: (id: string) => void;

  favoriteTabs: string[];
  toggleFavorite: (tabId: string) => void;

  collapsedProjectIds: string[];
  toggleProjectCollapsed: (id: string) => void;

  // 定位到会话所属的项目：展开项目与分类，遵循手风琴模式
  locateSession: (sessionId: string) => void;

  newProjectModalOpen: boolean;
  setNewProjectModalOpen: (open: boolean) => void;
  newSessionModalOpen: boolean;
  newSessionProjectId: string | null;
  newSessionCategoryId: string | null;
  setNewSessionModalOpen: (open: boolean, projectId?: string | null, categoryId?: string | null) => void;
  newCategoryModalOpen: boolean;
  newCategoryProjectId: string | null;
  setNewCategoryModalOpen: (open: boolean, projectId?: string | null) => void;

  // 编辑会话弹窗
  editSessionModalOpen: boolean;
  editingSessionId: string | null;
  setEditSessionModalOpen: (open: boolean, sessionId?: string | null) => void;

  sessionTemplates: SessionTemplate[];
  globalThinkingIntensity: string;
  setGlobalThinkingIntensity: (intensity: string) => void;

  profiles: Profile[];
  setProfiles: (profiles: Profile[]) => void;

  // LLM Provider 列表（从后端加载，与 Profile 解耦）
  llmProviders: LlmProvider[];
  setLlmProviders: (providers: LlmProvider[]) => void;
  loadLlmProviders: () => Promise<void>;
  createLlmProvider: (input: CreateLlmProviderInput) => Promise<LlmProvider>;
  updateLlmProvider: (id: string, input: UpdateLlmProviderInput) => Promise<LlmProvider>;
  deleteLlmProvider: (id: string) => Promise<void>;
  toggleLlmProviderActive: (id: string, isActive: boolean) => Promise<void>;

  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  theme: string;
  setTheme: (theme: string) => void;

  fontSize: number;
  setFontSize: (size: number) => void;

  uiFontFamily: string;
  setUiFontFamily: (font: string) => void;

  uiZoom: number;
  setUiZoom: (zoom: number) => void;

  compactMode: boolean;
  toggleCompactMode: () => void;

  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;

  settingsPage: boolean;
  setSettingsPage: (open: boolean) => void;

  // 设置面板当前激活的菜单项 key，用于跨页面跳转
  settingsActiveKey: string;
  setSettingsActiveKey: (key: string) => void;

  costTick: number;
  setCostTick: (tick: number) => void;

  terminalSettings: TerminalSettings;
  updateTerminalSetting: <K extends keyof TerminalSettings>(key: K, value: TerminalSettings[K]) => void;

  // 快捷命令（按 CLI 工具类型存储多行文本，每行一个命令）
  quickCommandsByToolType: Record<string, string>;
  updateQuickCommands: (toolType: string, value: string) => void;
}

const FAVORITE_KEY = "teacoder_favorites";
const COLLAPSED_KEY = "teacoder_collapsed_projects";
const COLLAPSED_CATEGORIES_KEY = "teacoder_collapsed_categories";

function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveFavorites(favorites: string[]) {
  try {
    localStorage.setItem(FAVORITE_KEY, JSON.stringify(favorites));
  } catch {
    // non-critical
  }
}

function loadCollapsed(): string[] {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCollapsed(collapsed: string[]) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed));
  } catch {
    // non-critical
  }
}

function loadCollapsedCategories(): string[] {
  try {
    const raw = localStorage.getItem(COLLAPSED_CATEGORIES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCollapsedCategories(collapsed: string[]) {
  try {
    localStorage.setItem(COLLAPSED_CATEGORIES_KEY, JSON.stringify(collapsed));
  } catch {
    // non-critical
  }
}

const initialOpenTabIds = loadOpenTabIds();

// 模块加载时即确定初始 pane id，避免在 store 初始 state 中调用 crypto.randomUUID()。
const INITIAL_PANE_ID = crypto.randomUUID();
const initialPanes: Pane[] = initialOpenTabIds.length > 0
  ? [{ id: INITIAL_PANE_ID, openTabIds: initialOpenTabIds, activeTabId: initialOpenTabIds[initialOpenTabIds.length - 1] }]
  : [];

export const useAppStore = create<AppState>((set, get) => ({
  cliTools: [],
  setCliTools: (tools) => set({ cliTools: tools }),

  // 项目
  projects: [],
  loadProjects: async () => {
    const projects = await projectList();
    set({ projects });
  },
  createProject: async (name, path, color) => {
    const project = await projectCreate({ name, path, color });
    set((state) => ({ projects: [...state.projects, project] }));
    return project;
  },
  updateProject: async (id, updates) => {
    const updated = await projectUpdate(id, updates);
    set((state) => ({
      projects: state.projects.map((p) => (p.id === id ? updated : p)),
    }));
  },
  deleteProject: async (id) => {
    await projectDelete(id);
    // 同时移除关联的 sessions
    const relatedSessions = get().sessions.filter((s) => s.projectId === id);
    for (const s of relatedSessions) {
      if (s.isRunning) {
        stopSession(s.id).catch(() => {});
      }
      await sessionDelete(s.id).catch(() => {});
    }
    set((state) => {
      const removed = new Set(relatedSessions.map((s) => s.id));
      const panes = state.panes
        .map((p) => ({
          ...p,
          openTabIds: p.openTabIds.filter((tid) => !removed.has(tid)),
          activeTabId: p.activeTabId && removed.has(p.activeTabId)
            ? (p.openTabIds.filter((tid) => !removed.has(tid)).slice(-1)[0] ?? null)
            : p.activeTabId,
        }))
        // 关闭后没有 tab 的面板自动清理
        .filter((p) => p.openTabIds.length > 0);
      const openTabIds = flattenPaneOpenIds(panes);
      const activePaneId = panes.some((p) => p.id === state.activePaneId)
        ? state.activePaneId
        : (panes[panes.length - 1]?.id ?? null);
      const activeTabId = paneActiveId(panes, activePaneId);
      saveOpenTabIds(openTabIds);
      return { projects: state.projects.filter((p) => p.id !== id), sessions: state.sessions.filter((s) => s.projectId !== id), panes, activePaneId, openTabIds, activeTabId };
    });
  },

  // 会话
  sessions: [],
  loadSessions: async () => {
    const sessions = await sessionList();
    // 后端 Session.claude_models 是 JSON 字符串；统一在入口层反序列化为对象
    const normalized = sessions.map((s) => ({
      ...s,
      claudeModels: parseClaudeModels(s.claudeModels),
    }));
    set({ sessions: normalized });
  },
  createSession: async (input) => {
    const cliSessionId = input.toolType === "claude" ? crypto.randomUUID() : undefined;
    const title = input.title;
    const session = await sessionCreate({
      ...input,
      claudeModels: serializeClaudeModels(input.claudeModels),
      title,
      cliSessionId,
    });
    const project = get().projects.find((p) => p.id === input.projectId);
    const envVars = parseEnvVars(input.envVars || "");
    await startSession({
      toolType: input.toolType,
      profileId: input.profileId || "",
      workDir: project?.path || "~",
      tabId: session.id,
      envVars,
      cliArgs: input.cliArgs,
      cliSessionId,
      llmProviderId: input.llmProviderId,
      modelName: input.modelName,
      claudeModels: serializeClaudeModels(input.claudeModels),
    });
    const updatedSession = {
      ...session,
      isRunning: true,
      claudeModels: parseClaudeModels(input.claudeModels),
    };
    set((state) => {
      // 创建新会话时，同时把它加入活动 pane（若无 pane 则新建一个）
      let nextPanes: Pane[];
      let nextActivePaneId: string | null;
      if (state.panes.length === 0) {
        const newPane: Pane = { id: crypto.randomUUID(), openTabIds: [session.id], activeTabId: session.id };
        nextPanes = [newPane];
        nextActivePaneId = newPane.id;
      } else {
        const targetPaneId = state.activePaneId ?? state.panes[state.panes.length - 1].id;
        nextPanes = state.panes.map((p) =>
          p.id === targetPaneId
            ? { ...p, openTabIds: [...p.openTabIds, session.id], activeTabId: session.id }
            : p,
        );
        nextActivePaneId = targetPaneId;
      }
      const openTabIds = flattenPaneOpenIds(nextPanes);
      saveOpenTabIds(openTabIds);
      return {
        sessions: [...state.sessions, updatedSession],
        panes: nextPanes,
        activePaneId: nextActivePaneId,
        openTabIds,
        activeTabId: session.id,
      };
    });
    return updatedSession;
  },
  updateSession: async (id, updates) => {
    const updated = await sessionUpdate(id, {
      ...updates,
      claudeModels: serializeClaudeModels(updates.claudeModels),
    });
    // 后端返回的 claudeModels 是字符串；解析后 merge 到 store，避免 store 中出现字符串状态
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id
          ? { ...s, ...updated, claudeModels: parseClaudeModels(updated.claudeModels) }
          : s,
      ),
    }));

    // Claude Code 会话且仍在运行：重启 PTY 以应用新的 env（1M 标记 / 模型映射变更）。
    // PTY 重启会中断当前 Claude Code 会话上下文，由用户编辑保存触发的"重启配置"语义所预期。
    const after = get().sessions.find((s) => s.id === id);
    if (after?.toolType === "claude" && after.isRunning) {
      stopSession(id).catch(() => {});
      const project = get().projects.find((p) => p.id === after.projectId);
      const envVars = parseEnvVars(after.envVars || "");
      const claudeConfigDir = (() => {
        const profile = after.profileId
          ? get().profiles.find((p) => p.id === after.profileId)
          : undefined;
        return profile?.appDataRoot ?? null;
      })();
      findLatestClaudeSession(project?.path || "~", claudeConfigDir, Date.now())
        .then((detected) => {
          const cliSessionId = detected ?? after.cliSessionId ?? undefined;
          let cliArgs = after.cliArgs || "[]";
          if (cliSessionId) {
            try {
              const args = JSON.parse(cliArgs) as string[];
              const hasResume = args.some((a) => a === "--resume" || a === "-r");
              if (!hasResume) cliArgs = JSON.stringify(["--resume", cliSessionId, ...args]);
            } catch {
              cliArgs = JSON.stringify(["--resume", cliSessionId]);
            }
          }
          startSession({
            toolType: after.toolType,
            profileId: after.profileId || "",
            workDir: project?.path || "~",
            tabId: id,
            envVars,
            cliArgs,
            cliSessionId: cliSessionId ?? undefined,
            llmProviderId: after.llmProviderId,
            modelName: after.modelName,
            claudeModels: serializeClaudeModels(after.claudeModels),
          }).catch(() => {});
        })
        .catch(() => {
          startSession({
            toolType: after.toolType,
            profileId: after.profileId || "",
            workDir: project?.path || "~",
            tabId: id,
            envVars,
            cliArgs: after.cliArgs || "[]",
            cliSessionId: after.cliSessionId ?? undefined,
            llmProviderId: after.llmProviderId,
            modelName: after.modelName,
            claudeModels: serializeClaudeModels(after.claudeModels),
          }).catch(() => {});
        });
    }
  },
  deleteSession: async (id) => {
    const session = get().sessions.find((s) => s.id === id);
    if (session?.isRunning) {
      stopSession(id).catch(() => {});
    }
    await sessionDelete(id);
    set((state) => {
      // 从所有 pane 里移除该 session
      const nextPanes: Pane[] = [];
      for (const p of state.panes) {
        const nextOpen = p.openTabIds.filter((tid) => tid !== id);
        if (nextOpen.length === 0) continue;
        const nextActive = p.activeTabId === id ? nextOpen[nextOpen.length - 1] : p.activeTabId;
        nextPanes.push({ ...p, openTabIds: nextOpen, activeTabId: nextActive });
      }
      const openTabIds = flattenPaneOpenIds(nextPanes);
      const activePaneId = nextPanes.some((p) => p.id === state.activePaneId)
        ? state.activePaneId
        : (nextPanes[nextPanes.length - 1]?.id ?? null);
      const activeTabId = paneActiveId(nextPanes, activePaneId);
      const favoriteTabs = state.favoriteTabs.filter((fid) => fid !== id);
      saveOpenTabIds(openTabIds);
      saveFavorites(favoriteTabs);
      return {
        sessions: state.sessions.filter((s) => s.id !== id),
        panes: nextPanes,
        activePaneId,
        openTabIds,
        activeTabId,
        favoriteTabs,
      };
    });
  },

  // 会话分类
  categories: [],
  loadCategories: async () => {
    const categories = await categoryList();
    set({ categories });
  },
  createCategory: async (input) => {
    const category = await categoryCreate(input);
    set((state) => ({
      categories: [...state.categories, category],
    }));
    return category;
  },
  updateCategory: async (id, updates) => {
    const updated = await categoryUpdate(id, updates);
    set((state) => ({
      categories: state.categories.map((c) => (c.id === id ? updated : c)),
    }));
  },
  deleteCategory: async (id) => {
    await categoryDelete(id);
    // 关联会话的 categoryId 置空
    const relatedSessions = get().sessions.filter((s) => s.categoryId === id);
    for (const s of relatedSessions) {
      await sessionUpdate(s.id, { categoryId: "" }).catch(() => {});
    }
    set((state) => ({
      categories: state.categories.filter((c) => c.id !== id),
      sessions: state.sessions.map((s) =>
        s.categoryId === id ? { ...s, categoryId: undefined } : s,
      ),
    }));
  },

  openTabIds: initialOpenTabIds,
  activeTabId: initialOpenTabIds.length > 0
    ? initialOpenTabIds[initialOpenTabIds.length - 1]
    : null,

  // 初始分屏结构：v0.1 启动时所有已恢复的标签放进一个面板。
  // 启动后用户可以右键 Split Left/Right 再创建第二个面板。
  panes: initialPanes,
  activePaneId: initialPanes.length > 0 ? INITIAL_PANE_ID : null,
  splitRatio: loadSplitRatio(),

  setActivePane: (paneId) => {
    set((state) => {
      if (!state.panes.some((p) => p.id === paneId)) return {};
      return { activePaneId: paneId, activeTabId: paneActiveId(state.panes, paneId) };
    });
  },

  setSplitRatio: (ratio) => {
    const clamped = Math.max(0.2, Math.min(0.8, ratio));
    set({ splitRatio: clamped });
    saveSplitRatio(clamped);
  },

  splitPane: (tabId, direction) => {
    set((state) => {
      // 已经有两个面板就拒绝再分屏（v0.1 边界）
      if (state.panes.length >= 2) return {};
      // tab 必须在某个 pane 里；找不到则拒绝
      const sourcePaneIdx = state.panes.findIndex((p) => p.openTabIds.includes(tabId));
      if (sourcePaneIdx < 0) return {};
      const sourcePane = state.panes[sourcePaneIdx];

      // 新面板的 openTabIds 暂时只放 tabId，activeTabId = tabId
      const newPane: Pane = { id: crypto.randomUUID(), openTabIds: [tabId], activeTabId: tabId };

      // 默认 ratio：若只有一个面板有内容，居中；若已有 1 个+新增，保留旧 ratio
      const ratio = state.panes.length === 1 ? state.splitRatio : 0.5;

      const nextPanes =
        direction === "right"
          ? [sourcePane, newPane]
          : [newPane, sourcePane];

      // 焦点切到新面板，让用户立即看到分屏效果
      return {
        panes: nextPanes,
        activePaneId: newPane.id,
        splitRatio: ratio,
        openTabIds: flattenPaneOpenIds(nextPanes),
        activeTabId: tabId,
      };
    });
  },

  closePane: (paneId) => {
    set((state) => {
      if (state.panes.length <= 1) return {}; // 最后一个面板不能关
      const idx = state.panes.findIndex((p) => p.id === paneId);
      if (idx < 0) return {};
      const closing = state.panes[idx];

      // 关闭面板里的所有 PTY
      for (const tid of closing.openTabIds) {
        const s = state.sessions.find((sess) => sess.id === tid);
        if (s?.isRunning) stopSession(tid).catch(() => {});
        sessionUpdate(tid, { isRunning: false, closedAt: Date.now() }).catch(() => {});
      }

      const remaining = state.panes.filter((_, i) => i !== idx);
      // 焦点切到剩余面板里最后一个
      const newActivePaneId = remaining[remaining.length - 1]?.id ?? null;
      const newActiveTabId = paneActiveId(remaining, newActivePaneId);
      const openTabIds = flattenPaneOpenIds(remaining);
      saveOpenTabIds(openTabIds);
      return {
        panes: remaining,
        activePaneId: newActivePaneId,
        openTabIds,
        activeTabId: newActiveTabId,
      };
    });
  },

  closeAllTabs: () => {
    const state = get();
    // 停止所有运行中的会话
    for (const session of state.sessions) {
      if (session.isRunning) {
        stopSession(session.id).catch(() => {});
      }
    }
    set({ panes: [], activePaneId: null, openTabIds: [], activeTabId: null });
    saveOpenTabIds([]);
  },

  closeTab: (id) => {
    const state = get();
    const session = state.sessions.find((s) => s.id === id);

    // Claude Code 关闭标签前，先探测 work_dir 下 mtime <= 当前时刻的最近 JSONL，
    // 确保 cliSessionId 与磁盘上最近一次写入的 JSONL UUID 一致。
    // 这样即使 /clear 改变了文件 mtime，cliSessionId 也会与最新 JSONL 对齐；
    // 多标签同 work_dir 时，本会话 JSONL 必然不晚于当前时间（我们还没停 PTY）。
    if (session?.isRunning && session.toolType === "claude") {
      const project = state.projects.find((p) => p.id === session.projectId);
      const profile = session.profileId
        ? state.profiles.find((p) => p.id === session.profileId)
        : undefined;
      const workDir = project?.path || "~";
      const claudeConfigDir = profile?.appDataRoot ?? null;
      findLatestClaudeSession(workDir, claudeConfigDir, Date.now())
        .then((detected) => {
          if (detected && detected !== session.cliSessionId) {
            sessionUpdate(id, { cliSessionId: detected }).catch(() => {});
            set((s) => ({
              sessions: s.sessions.map((sess) =>
                sess.id === id ? { ...sess, cliSessionId: detected } : sess,
              ),
            }));
          }
        })
        .catch(() => {
          // 探测失败时不影响关闭流程
        });
    }

    if (session?.isRunning) {
      stopSession(id).catch(() => {});
    }
    // 标记 closedAt 和 isRunning
    sessionUpdate(id, { isRunning: false, closedAt: Date.now() }).catch(() => {});
    set((state) => {
      const sessions = state.sessions.map((s) =>
        s.id === id ? { ...s, isRunning: false, closedAt: Date.now() } : s,
      );
      // 从所有 pane 里移除该 tab；若移除后面板空了，整个面板也清掉
      const nextPanes: Pane[] = [];
      let fallbackActiveForClosedPane: string | null = null;
      for (const p of state.panes) {
        const nextOpen = p.openTabIds.filter((tid) => tid !== id);
        if (nextOpen.length === 0) continue;
        let nextActive = p.activeTabId;
        if (p.activeTabId === id) {
          nextActive = nextOpen[nextOpen.length - 1];
          // 记录"如果该面板的 active 被关掉了，备选 active 用于全局回退"
          if (p.id === state.activePaneId) fallbackActiveForClosedPane = nextActive;
        }
        nextPanes.push({ ...p, openTabIds: nextOpen, activeTabId: nextActive });
      }
      const openTabIds = flattenPaneOpenIds(nextPanes);
      saveOpenTabIds(openTabIds);
      const activeTabId = paneActiveId(nextPanes, state.activePaneId) ?? fallbackActiveForClosedPane ?? null;
      return { sessions, panes: nextPanes, openTabIds, activeTabId };
    });
  },

  openTab: (id) => {
    const state = get();
    // 已在任意 pane 打开：把焦点切到那个 pane 并激活该 tab
    for (const p of state.panes) {
      if (p.openTabIds.includes(id)) {
        set({ activePaneId: p.id, activeTabId: id });
        return;
      }
    }
    const session = state.sessions.find((s) => s.id === id);
    if (!session) return;
    // 从 projects 查找 workDir
    const project = state.projects.find((p) => p.id === session.projectId);
    const envVars = parseEnvVars(session.envVars || "");
    // 重新打开 Claude Code 会话时恢复对话
    let cliArgs = session.cliArgs || "[]";
    let args: string[] = [];
    try { args = JSON.parse(cliArgs); } catch { /* ignore */ }
    // 检查是否已有恢复参数
    const hasResume = args.some((a) => a === "--resume" || a === "-r");
    const hasContinue = args.some((a) => a === "--continue" || a === "-c");
    let willResumeSessionId: string | undefined;
    // Terminal 类型不支持 --resume/--continue，保持原样启动
    if (session.toolType !== "terminal") {
      if (session.cliSessionId && !hasResume && !hasContinue) {
        // 有 cliSessionId：精确恢复到特定对话
        args = ["--resume", session.cliSessionId, ...args];
        cliArgs = JSON.stringify(args);
        willResumeSessionId = session.cliSessionId;
      } else if (!session.cliSessionId && !hasResume && !hasContinue) {
        // 旧会话无 cliSessionId：回退到恢复当前目录最近对话
        args = ["--continue", ...args];
        cliArgs = JSON.stringify(args);
      }
    }
    // 启动会话，失败时回退到新会话
    startSession({
      toolType: session.toolType,
      profileId: session.profileId || "",
      workDir: project?.path || "~",
      tabId: id,
      envVars,
      cliArgs,
      cliSessionId: willResumeSessionId,
      llmProviderId: session.llmProviderId,
      modelName: session.modelName,
      claudeModels: serializeClaudeModels(session.claudeModels),
    }).catch((err) => {
      // --resume 在交互模式下因跟踪文件被清理而失败。
      // 主动探测 work_dir 下最近的 JSONL：若存在，则用其 UUID + --session-id
      // 重新启动，让 Claude Code 继续现有 JSONL 而不是从空白开始。
      if (!willResumeSessionId || !String(err).includes("No conversation found")) {
        return;
      }
      const workDir = project?.path || "~";
      const profile = session.profileId
        ? state.profiles.find((p) => p.id === session.profileId)
        : undefined;
      const claudeConfigDir = profile?.appDataRoot ?? null;
      findLatestClaudeSession(workDir, claudeConfigDir, Date.now())
        .then((detected) => {
          if (!detected) {
            // 工作目录下没有任何 JSONL：保持原回退，从空白会话启动
            sessionUpdate(id, { cliSessionId: undefined }).catch(() => {});
            startSession({
              toolType: session.toolType,
              profileId: session.profileId || "",
              workDir,
              tabId: id,
              envVars,
              cliArgs: "[]",
              cliSessionId: undefined,
              llmProviderId: session.llmProviderId,
              modelName: session.modelName,
              claudeModels: serializeClaudeModels(session.claudeModels),
            }).catch(() => {});
            return;
          }
          // 用探测到的 UUID + --session-id 启动 Claude Code，让其继续现有 JSONL
          sessionUpdate(id, { cliSessionId: detected }).catch(() => {});
          startSession({
            toolType: session.toolType,
            profileId: session.profileId || "",
            workDir,
            tabId: id,
            envVars,
            cliArgs: JSON.stringify(["--session-id", detected]),
            cliSessionId: detected,
            llmProviderId: session.llmProviderId,
            modelName: session.modelName,
            claudeModels: serializeClaudeModels(session.claudeModels),
          }).catch(() => {});
        })
        .catch(() => {
          // 探测本身失败时仍走原始回退路径，避免卡死
          sessionUpdate(id, { cliSessionId: undefined }).catch(() => {});
          startSession({
            toolType: session.toolType,
            profileId: session.profileId || "",
            workDir,
            tabId: id,
            envVars,
            cliArgs: "[]",
            cliSessionId: undefined,
            llmProviderId: session.llmProviderId,
            modelName: session.modelName,
            claudeModels: serializeClaudeModels(session.claudeModels),
          }).catch(() => {});
        });
    });
    // 标记 isRunning，清除 closedAt
    sessionUpdate(id, { isRunning: true, closedAt: 0 }).catch(() => {});
    set((state) => {
      const sessions = state.sessions.map((s) =>
        s.id === id ? { ...s, isRunning: true, closedAt: undefined } : s,
      );
      // 把新 tab 加到当前活动 pane；若无 pane 则新建一个
      let nextPanes: Pane[];
      let nextActivePaneId: string | null;
      if (state.panes.length === 0) {
        const newPane: Pane = { id: crypto.randomUUID(), openTabIds: [id], activeTabId: id };
        nextPanes = [newPane];
        nextActivePaneId = newPane.id;
      } else {
        const targetPaneId = state.activePaneId ?? state.panes[state.panes.length - 1].id;
        nextPanes = state.panes.map((p) =>
          p.id === targetPaneId
            ? { ...p, openTabIds: [...p.openTabIds, id], activeTabId: id }
            : p,
        );
        nextActivePaneId = targetPaneId;
      }
      const openTabIds = flattenPaneOpenIds(nextPanes);
      saveOpenTabIds(openTabIds);
      return { sessions, panes: nextPanes, activePaneId: nextActivePaneId, openTabIds, activeTabId: id };
    });
  },

  restoreTabs: () => {
    const state = get();
    const tabIds = state.openTabIds;
    if (tabIds.length === 0) return;
    // 过滤出仍存在于 sessions 中的 ID
    const validIds = tabIds.filter((id) => state.sessions.some((s) => s.id === id));
    if (validIds.length === 0) {
      set({ openTabIds: [], activeTabId: null, panes: [], activePaneId: null });
      saveOpenTabIds([]);
      return;
    }
    // 先清空 openTabIds/panes，再逐个调用 openTab 以触发 PTY 启动和 --resume
    set({ openTabIds: [], activeTabId: null, panes: [], activePaneId: null });
    for (const id of validIds) {
      get().openTab(id);
    }
  },

  setActiveTab: (id) => {
    set((state) => {
      // 同步更新活动 pane 的 activeTabId；未指定 pane 时取当前 activePaneId
      const paneId = state.activePaneId ?? state.panes[state.panes.length - 1]?.id;
      if (!paneId) return { activeTabId: id };
      const nextPanes = state.panes.map((p) =>
        p.id === paneId ? { ...p, activeTabId: id } : p,
      );
      return { panes: nextPanes, activeTabId: id };
    });
  },

  duplicateSession: (id) => {
    const state = get();
    const src = state.sessions.find((s) => s.id === id);
    if (!src) return;
    // 创建新 session（同 projectId，标题加"副本"）
    sessionCreate({
      projectId: src.projectId,
      toolType: src.toolType,
      title: src.title ? `${src.title} 副本` : undefined,
      profileId: src.profileId,
      color: src.color,
      thinkingIntensity: src.thinkingIntensity,
      templateId: src.templateId,
      cliArgs: src.cliArgs,
      envVars: src.envVars,
    }).then((newSession) => {
      set((state) => {
        const sessions = [...state.sessions, newSession];
        // 把新 tab 加到当前活动 pane；若无 pane 则新建一个
        let nextPanes: Pane[];
        let nextActivePaneId: string | null;
        if (state.panes.length === 0) {
          const newPane: Pane = { id: crypto.randomUUID(), openTabIds: [newSession.id], activeTabId: newSession.id };
          nextPanes = [newPane];
          nextActivePaneId = newPane.id;
        } else {
          const targetPaneId = state.activePaneId ?? state.panes[state.panes.length - 1].id;
          nextPanes = state.panes.map((p) =>
            p.id === targetPaneId
              ? { ...p, openTabIds: [...p.openTabIds, newSession.id], activeTabId: newSession.id }
              : p,
          );
          nextActivePaneId = targetPaneId;
        }
        const openTabIds = flattenPaneOpenIds(nextPanes);
        saveOpenTabIds(openTabIds);
        return { sessions, panes: nextPanes, activePaneId: nextActivePaneId, openTabIds, activeTabId: newSession.id };
      });
    }).catch(() => {});
  },

  closeOtherTabs: (id) => {
    const state = get();
    // 找到 id 所在的 pane，把其他 pane 全部清空
    const hostPaneIdx = state.panes.findIndex((p) => p.openTabIds.includes(id));
    if (hostPaneIdx < 0) return;
    // 关闭其他 pane 里的所有 tab
    state.panes.forEach((p, i) => {
      if (i === hostPaneIdx) return;
      p.openTabIds.forEach((tid) => {
        const s = state.sessions.find((sess) => sess.id === tid);
        if (s?.isRunning) stopSession(tid).catch(() => {});
        sessionUpdate(tid, { isRunning: false, closedAt: Date.now() }).catch(() => {});
      });
    });
    // 同一个 pane 内 id 之外的其他 tab 也要关
    const hostPane = state.panes[hostPaneIdx];
    const intraCloseIds = hostPane.openTabIds.filter((tid) => tid !== id);
    intraCloseIds.forEach((tid) => {
      const s = state.sessions.find((sess) => sess.id === tid);
      if (s?.isRunning) stopSession(tid).catch(() => {});
      sessionUpdate(tid, { isRunning: false, closedAt: Date.now() }).catch(() => {});
    });
    set((state) => {
      const hostPaneNew: Pane = { id: hostPane.id, openTabIds: [id], activeTabId: id };
      const nextPanes = [hostPaneNew];
      const sessions = state.sessions.map((s) => {
        const allClosed = new Set([
          ...state.panes.flatMap((p) => p.openTabIds),
        ]);
        if (allClosed.has(s.id) && s.id !== id) {
          return { ...s, isRunning: false, closedAt: Date.now() };
        }
        return s;
      });
      const openTabIds = [id];
      saveOpenTabIds(openTabIds);
      return { panes: nextPanes, activePaneId: hostPane.id, sessions, openTabIds, activeTabId: id };
    });
  },

  closeTabsToRight: (id) => {
    // v0.1：在当前 pane 内关闭 id 右侧的标签；不影响其他 pane
    const state = get();
    const pane = state.panes.find((p) => p.openTabIds.includes(id));
    if (!pane) return;
    const idx = pane.openTabIds.indexOf(id);
    if (idx < 0) return;
    const closingIds = pane.openTabIds.slice(idx + 1);
    closingIds.forEach((tid) => {
      const s = state.sessions.find((sess) => sess.id === tid);
      if (s?.isRunning) stopSession(tid).catch(() => {});
      sessionUpdate(tid, { isRunning: false, closedAt: Date.now() }).catch(() => {});
    });
    set((state) => {
      const nextPanes = state.panes.map((p) => {
        if (p.id !== pane.id) return p;
        const nextOpen = p.openTabIds.slice(0, idx + 1);
        const nextActive = p.activeTabId && !nextOpen.includes(p.activeTabId) ? id : p.activeTabId;
        return { ...p, openTabIds: nextOpen, activeTabId: nextActive };
      });
      const sessions = state.sessions.map((s) =>
        closingIds.includes(s.id) ? { ...s, isRunning: false, closedAt: Date.now() } : s,
      );
      const openTabIds = flattenPaneOpenIds(nextPanes);
      saveOpenTabIds(openTabIds);
      const activeTabId = paneActiveId(nextPanes, state.activePaneId);
      return { panes: nextPanes, openTabIds, sessions, activeTabId };
    });
  },

  favoriteTabs: loadFavorites(),
  toggleFavorite: (tabId) =>
    set((state) => {
      const favorites = state.favoriteTabs.includes(tabId)
        ? state.favoriteTabs.filter((id) => id !== tabId)
        : [...state.favoriteTabs, tabId];
      saveFavorites(favorites);
      return { favoriteTabs: favorites };
    }),

  collapsedProjectIds: loadCollapsed(),
  toggleProjectCollapsed: (id) =>
    set((state) => {
      const isCurrentlyCollapsed = state.collapsedProjectIds.includes(id);
      // 手风琴模式：展开某个项目时，自动折叠其他所有已展开的项目
      const collapsed = isCurrentlyCollapsed
        ? Array.from(
            new Set([
              ...state.collapsedProjectIds.filter((d) => d !== id),
              ...state.projects
                .filter((p) => p.id !== id && !state.collapsedProjectIds.includes(p.id))
                .map((p) => p.id),
            ]),
          )
        : [...state.collapsedProjectIds, id];
      saveCollapsed(collapsed);
      return { collapsedProjectIds: collapsed };
    }),

  // 定位到会话所属的项目与分类（手风琴模式：只展开该项目）
  locateSession: (sessionId) => {
    const state = get();
    const session = state.sessions.find((s) => s.id === sessionId);
    if (!session) return;
    const projectId = session.projectId;
    const categoryId = session.categoryId;
    if (!state.projects.some((p) => p.id === projectId)) return;

    const collapsedProjects = state.projects
      .filter((p) => p.id !== projectId)
      .map((p) => p.id);
    const collapsedCategories = categoryId
      ? state.collapsedCategoryIds.filter((id) => id !== categoryId)
      : state.collapsedCategoryIds;

    const projectsChanged =
      collapsedProjects.length !== state.collapsedProjectIds.length ||
      !collapsedProjects.every((id, i) => state.collapsedProjectIds[i] === id);
    const categoriesChanged =
      collapsedCategories.length !== state.collapsedCategoryIds.length;
    if (!projectsChanged && !categoriesChanged) return;

    saveCollapsed(collapsedProjects);
    if (categoriesChanged) saveCollapsedCategories(collapsedCategories);
    set({ collapsedProjectIds: collapsedProjects, collapsedCategoryIds: collapsedCategories });
  },

  collapsedCategoryIds: loadCollapsedCategories(),
  toggleCategoryCollapsed: (id) =>
    set((state) => {
      const collapsed = state.collapsedCategoryIds.includes(id)
        ? state.collapsedCategoryIds.filter((d) => d !== id)
        : [...state.collapsedCategoryIds, id];
      saveCollapsedCategories(collapsed);
      return { collapsedCategoryIds: collapsed };
    }),

  newProjectModalOpen: false,
  setNewProjectModalOpen: (open) => set({ newProjectModalOpen: open }),
  newSessionModalOpen: false,
  newSessionProjectId: null,
  newSessionCategoryId: null,
  setNewSessionModalOpen: (open, projectId, categoryId) =>
    set({
      newSessionModalOpen: open,
      newSessionProjectId: open ? (projectId ?? null) : null,
      newSessionCategoryId: open ? (categoryId ?? null) : null,
    }),
  newCategoryModalOpen: false,
  newCategoryProjectId: null,
  setNewCategoryModalOpen: (open, projectId) =>
    set({ newCategoryModalOpen: open, newCategoryProjectId: open ? (projectId ?? null) : null }),

  editSessionModalOpen: false,
  editingSessionId: null,
  setEditSessionModalOpen: (open, sessionId) =>
    set({ editSessionModalOpen: open, editingSessionId: open ? (sessionId ?? null) : null }),

  sessionTemplates: BUILTIN_SESSION_TEMPLATES,
  globalThinkingIntensity: "medium",
  setGlobalThinkingIntensity: (intensity) => set({ globalThinkingIntensity: intensity }),

  profiles: [],
  setProfiles: (profiles) => set({ profiles }),

  // LLM Provider
  llmProviders: [],
  setLlmProviders: (providers) => set({ llmProviders: providers }),
  loadLlmProviders: async () => {
    const providers = await listLlmProviders(false);
    set({ llmProviders: providers });
  },
  createLlmProvider: async (input) => {
    const created = await createLlmProviderIpc(input);
    await get().loadLlmProviders();
    return created;
  },
  updateLlmProvider: async (id, input) => {
    const updated = await updateLlmProviderIpc(id, input);
    await get().loadLlmProviders();
    return updated;
  },
  deleteLlmProvider: async (id) => {
    await deleteLlmProviderIpc(id);
    await get().loadLlmProviders();
  },
  toggleLlmProviderActive: async (id, isActive) => {
    await updateLlmProviderIpc(id, { isActive });
    await get().loadLlmProviders();
  },

  sidebarCollapsed: false,
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  theme: loadAppTheme(),
  setTheme: (theme) => {
    set({ theme });
    persistGeneralSetting("theme", theme);
  },

  fontSize: (() => {
    try {
      const raw = localStorage.getItem(GENERAL_SETTINGS_KEY);
      const saved = raw ? JSON.parse(raw) : {};
      return typeof saved.fontSize === "number" ? saved.fontSize : 14;
    } catch { return 14; }
  })(),
  setFontSize: (size: number) => {
    set({ fontSize: size });
    persistGeneralSetting("fontSize", size);
  },

  uiFontFamily: (() => {
    try {
      const raw = localStorage.getItem(GENERAL_SETTINGS_KEY);
      const saved = raw ? JSON.parse(raw) : {};
      return typeof saved.uiFontFamily === "string" && saved.uiFontFamily
        ? saved.uiFontFamily
        : "system-ui";
    } catch { return "system-ui"; }
  })(),
  setUiFontFamily: (font: string) => {
    set({ uiFontFamily: font });
    persistGeneralSetting("uiFontFamily", font);
  },

  uiZoom: (() => {
    try {
      const raw = localStorage.getItem(GENERAL_SETTINGS_KEY);
      const saved = raw ? JSON.parse(raw) : {};
      return typeof saved.uiZoom === "number" ? saved.uiZoom : 100;
    } catch { return 100; }
  })(),
  setUiZoom: (zoom: number) => {
    set({ uiZoom: zoom });
    persistGeneralSetting("uiZoom", zoom);
  },

  compactMode: false,
  toggleCompactMode: () =>
    set((state) => ({ compactMode: !state.compactMode })),

  searchOpen: false,
  setSearchOpen: (open) => set({ searchOpen: open }),

  settingsPage: false,
  setSettingsPage: (open) => set({ settingsPage: open }),

  settingsActiveKey: "general",
  setSettingsActiveKey: (key) => set({ settingsActiveKey: key }),

  costTick: 0,
  setCostTick: (tick) => set({ costTick: tick }),

  terminalSettings: loadTerminalSettings(),
  updateTerminalSetting: (key, value) =>
    set((state) => {
      const settings = { ...state.terminalSettings, [key]: value };
      saveTerminalSettings(settings);
      return { terminalSettings: settings };
    }),

  quickCommandsByToolType: loadQuickCommands(),
  updateQuickCommands: (toolType, value) =>
    set((state) => {
      const next = { ...state.quickCommandsByToolType, [toolType]: value };
      saveQuickCommands(next);
      return { quickCommandsByToolType: next };
    }),
}));

function parseEnvVars(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}
