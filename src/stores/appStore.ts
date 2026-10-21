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
import { DEFAULT_TERMINAL_SETTINGS, BUILTIN_SESSION_TEMPLATES, TOOL_DISPLAY_NAMES } from "../types";
import {
  stopSession,
  startSession,
  writeToPty,
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
  claudeJsonlExists,
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
const PANES_LAYOUT_KEY = "teacoder_panes_layout";

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

interface PersistedPanesLayout {
  version: 2;
  panes: Pane[];
  activePaneId: string | null;
}

/**
 * 加载上次保存的分屏布局。
 * 校验：每个 pane 都有合法 id；tabId 列表里至少有一个；activeTabId 必须属于本 pane。
 * 校验失败时返回 null（让调用方走"回退到单面板"逻辑）。
 *
 * v2 升级:支持同 tabId 跨 pane 重复(openTabIds 不强制去重);
 * 从 v1 读到的 layout 视为 v2 的子集(因为 v1 本身就不重复),无需数据迁移。
 */
function loadPanesLayout(): PersistedPanesLayout | null {
  try {
    const raw = localStorage.getItem(PANES_LAYOUT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedPanesLayout;
    // 反序列化后 version 是字面量类型,显式收宽为 number
    const v = parsed.version as number;
    if ((v !== 1 && v !== 2) || !Array.isArray(parsed.panes)) return null;
    if (parsed.panes.length < 1 || parsed.panes.length > 2) return null;
    for (const p of parsed.panes) {
      if (typeof p.id !== "string" || !Array.isArray(p.openTabIds)) return null;
      if (p.openTabIds.length === 0) return null;
      if (p.activeTabId && !p.openTabIds.includes(p.activeTabId)) {
        // activeTabId 失效时回退到最后一个
        p.activeTabId = p.openTabIds[p.openTabIds.length - 1];
      }
      if (!p.activeTabId) p.activeTabId = p.openTabIds[p.openTabIds.length - 1] ?? null;
    }
    if (parsed.activePaneId && !parsed.panes.some((p) => p.id === parsed.activePaneId)) {
      parsed.activePaneId = parsed.panes[parsed.panes.length - 1].id;
    }
    // v1 升级:清除老 openTabIds key,防双源不一致
    if (v === 1) {
      try { localStorage.removeItem(OPEN_TABS_KEY); } catch { /* ignore */ }
    }
    parsed.version = 2;
    return parsed;
  } catch {
    return null;
  }
}

function savePanesLayout(panes: Pane[], activePaneId: string | null) {
  try {
    const payload: PersistedPanesLayout = { version: 2, panes, activePaneId };
    localStorage.setItem(PANES_LAYOUT_KEY, JSON.stringify(payload));
  } catch {
    // non-critical
  }
}

function clearPanesLayout() {
  try {
    localStorage.removeItem(PANES_LAYOUT_KEY);
  } catch {
    // ignore
  }
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

// 共享 PTY 语义：tabId 在所有 pane 中出现的总次数。
// 用于"最后一个实例关闭时才停 PTY"的 refcount 判断。
function instanceCount(panes: Pane[], tabId: string): number {
  let n = 0;
  for (const p of panes) {
    for (const tid of p.openTabIds) {
      if (tid === tabId) n++;
    }
  }
  return n;
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
  /**
   * 跨面板移动 tab。
   * - sourcePaneId 不传时自动定位 tab 所在 pane
   * - targetPaneId 不传时移动到当前 activePane
   * - insertIndex 不传时追加到目标 pane 末尾
   */
  moveTabToPane: (tabId: string, targetPaneId: string, insertIndex?: number) => void;
  reorderTabInPane: (paneId: string, fromIndex: number, toIndex: number) => void;
  setSplitRatio: (ratio: number) => void;

  closeTab: (id: string, paneId?: string) => void;
  openTab: (id: string, opts?: { targetPaneId?: string }) => Promise<void>;
  restoreTabs: () => void;
  closeAllTabs: () => void;
  setActiveTab: (id: string | null) => void;
  duplicateSession: (id: string) => Promise<Session | null>;
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

  // 通过顶部"帮助"按钮主动打开的引导（与首次启动自动引导解耦）
  manualGuideOpen: boolean;
  setManualGuideOpen: (open: boolean) => void;

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

// 优先用持久化的分屏布局；回退到旧的 openTabIds 单面板
const persistedLayout = loadPanesLayout();
const initialPanes: Pane[] = persistedLayout
  ? persistedLayout.panes
  : (initialOpenTabIds.length > 0
    ? [{ id: INITIAL_PANE_ID, openTabIds: initialOpenTabIds, activeTabId: initialOpenTabIds[initialOpenTabIds.length - 1] }]
    : []);

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
    // Claude Code：等 PTY 稳定后用 /rename 把 TeaCoder 标题同步过去。
    // 固定 3 秒延迟：用户实测启动 + 写首个 JSONL 平均 < 2s；/rename 是交互式命令，
    // 必须在 Claude Code 提示符出现后才能正确消费，太早会被吞进 stdin 缓冲。
    if (input.toolType === "claude" && title) {
      const tabId = session.id;
      const safeTitle = title.replace(/[\r\n]+/g, " ").trim();
      setTimeout(() => {
        if (safeTitle) writeToPty(tabId, `/rename ${safeTitle}\r`).catch(() => {});
      }, 3000);
    }
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
    // 共享 PTY 语义:若该 tabId 在多个 pane 中共享(双开),stop+start 会让另一 pane 失联,
    // 这里跳过重启,只更新 DB 字段;用户需先关闭双开才能应用 env 变更。
    // 重启时直接使用 DB 中的 cliSessionId（TeaCoder 预分配 + --session-id 注入），
    // 不再探测 find_latest_claude_session；JSONL 是否存在由下次 openTab 的预检负责。
    const after = get().sessions.find((s) => s.id === id);
    const sharedInstances = after ? instanceCount(get().panes, id) : 0;
    if (after?.toolType === "claude" && after.isRunning && sharedInstances <= 1) {
      stopSession(id).catch(() => {});
      const project = get().projects.find((p) => p.id === after.projectId);
      const envVars = parseEnvVars(after.envVars || "");
      const cliSessionId = after.cliSessionId ?? undefined;
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
        cliSessionId,
        llmProviderId: after.llmProviderId,
        modelName: after.modelName,
        claudeModels: serializeClaudeModels(after.claudeModels),
      }).catch(() => {});
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

  openTabIds: flattenPaneOpenIds(initialPanes),
  activeTabId: paneActiveId(initialPanes, persistedLayout?.activePaneId ?? (initialPanes[0]?.id ?? null)),

  // 初始分屏结构：优先用持久化布局；否则 v0.1 启动时所有已恢复的标签放进一个面板。
  panes: initialPanes,
  activePaneId: persistedLayout?.activePaneId ?? (initialPanes[0]?.id ?? null),
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

      // 共享 PTY 语义：同 tabId 已在 sourcePane 中存在,新 pane 再加一次,共享后端 PtyEntry。
      // 后端 start_session 已是 idempotent,无需再调一次;但 reader 线程已在 source pane
      // 启动时建立,output 会自动广播到新 pane 的 TerminalView。
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
      const remaining = state.panes.filter((_, i) => i !== idx);

      // 共享 PTY 语义：仅对"该 tabId 在 remaining 中 instance count === 0"的 tabId 停 PTY
      const closingTabs = new Set(closing.openTabIds);
      for (const tid of closingTabs) {
        if (instanceCount(remaining, tid) > 0) continue; // 另一 pane 还开着,不停
        const s = state.sessions.find((sess) => sess.id === tid);
        if (s?.isRunning) stopSession(tid).catch(() => {});
        sessionUpdate(tid, { isRunning: false, closedAt: Date.now() }).catch(() => {});
      }

      // 焦点切到剩余面板里最后一个
      const newActivePaneId = remaining[remaining.length - 1]?.id ?? null;
      const newActiveTabId = paneActiveId(remaining, newActivePaneId);
      const openTabIds = flattenPaneOpenIds(remaining);
      const zeroedIds = new Set(
        Array.from(closingTabs).filter((tid) => instanceCount(remaining, tid) === 0),
      );
      const sessions = state.sessions.map((s) =>
        zeroedIds.has(s.id) ? { ...s, isRunning: false, closedAt: Date.now() } : s,
      );
      saveOpenTabIds(openTabIds);
      return {
        panes: remaining,
        activePaneId: newActivePaneId,
        openTabIds,
        activeTabId: newActiveTabId,
        sessions,
      };
    });
  },

  moveTabToPane: (tabId, targetPaneId, insertIndex) => {
    set((state) => {
      if (!state.panes.some((p) => p.id === targetPaneId)) return {};
      // 找到含 tabId 的所有 source pane（共享 PTY 语义：可能多个）
      const sourcePaneIds = state.panes
        .filter((p) => p.openTabIds.includes(tabId) && p.id !== targetPaneId)
        .map((p) => p.id);
      if (sourcePaneIds.length === 0) {
        // 没有"其他" source pane：要么 tabId 不存在,要么只在 target pane 里（同 pane 移动）
        const onlyPane = state.panes.find((p) => p.id === targetPaneId);
        if (!onlyPane || !onlyPane.openTabIds.includes(tabId)) return {};
        // 同 pane reorder
        const fromIdx = onlyPane.openTabIds.indexOf(tabId);
        const toIdx = insertIndex ?? onlyPane.openTabIds.length - 1;
        if (fromIdx === toIdx || (fromIdx === toIdx - 1 && toIdx === onlyPane.openTabIds.length)) {
          return {};
        }
        const newOpen = [...onlyPane.openTabIds];
        newOpen.splice(fromIdx, 1);
        const adjustedTo = toIdx > fromIdx ? toIdx - 1 : toIdx;
        newOpen.splice(adjustedTo, 0, tabId);
        const nextPanes = state.panes.map((p) =>
          p.id === targetPaneId ? { ...p, openTabIds: newOpen } : p,
        );
        const openTabIds = flattenPaneOpenIds(nextPanes);
        saveOpenTabIds(openTabIds);
        return { panes: nextPanes, openTabIds };
      }

      // 跨 pane 移动：把每个 source pane 里的第一个 occurrence 移除
      // 防御性:同 pane 不重复(由 openTab 保证),但跨 pane 可重复
      const targetPane = state.panes.find((p) => p.id === targetPaneId)!;
      // 计算 target 插入位置(在"移除前"还是"移除后"长度基准?这里用移除后,
      // 因为跨 pane 移动通常只关心 target 内的相对位置)
      const targetNextOpen = [...targetPane.openTabIds];
      const insertAt = insertIndex !== undefined
        ? Math.max(0, Math.min(insertIndex, targetNextOpen.length))
        : targetNextOpen.length;
      targetNextOpen.splice(insertAt, 0, tabId);

      const nextPanes: Pane[] = [];
      for (const p of state.panes) {
        if (sourcePaneIds.includes(p.id)) {
          const idx = p.openTabIds.indexOf(tabId);
          if (idx < 0) {
            // 已被前面 pane 处理过？这里每 pane 只处理一次,不会重复
            nextPanes.push(p);
            continue;
          }
          const nextOpen = [...p.openTabIds.slice(0, idx), ...p.openTabIds.slice(idx + 1)];
          if (nextOpen.length === 0) continue; // 源 pane 变空 → 删除
          // active 切换:若 source pane 的 activeTabId === tabId,切到该 pane 剩余最后一个
          const nextActive = p.activeTabId === tabId
            ? (nextOpen[nextOpen.length - 1] ?? null)
            : p.activeTabId;
          nextPanes.push({ ...p, openTabIds: nextOpen, activeTabId: nextActive });
        } else if (p.id === targetPane.id) {
          nextPanes.push({ ...p, openTabIds: targetNextOpen, activeTabId: tabId });
        } else {
          nextPanes.push(p);
        }
      }

      const openTabIds = flattenPaneOpenIds(nextPanes);
      const newActivePaneId = targetPane.id;
      saveOpenTabIds(openTabIds);
      return {
        panes: nextPanes,
        activePaneId: newActivePaneId,
        openTabIds,
        activeTabId: tabId,
      };
    });
  },

  reorderTabInPane: (paneId, fromIndex, toIndex) => {
    set((state) => {
      const pane = state.panes.find((p) => p.id === paneId);
      if (!pane) return {};
      if (fromIndex < 0 || fromIndex >= pane.openTabIds.length) return {};
      const clampedTo = Math.max(0, Math.min(toIndex, pane.openTabIds.length - 1));
      if (fromIndex === clampedTo) return {};
      const newOpen = [...pane.openTabIds];
      const [moved] = newOpen.splice(fromIndex, 1);
      newOpen.splice(clampedTo, 0, moved);
      const nextPanes = state.panes.map((p) =>
        p.id === paneId ? { ...p, openTabIds: newOpen } : p,
      );
      const openTabIds = flattenPaneOpenIds(nextPanes);
      saveOpenTabIds(openTabIds);
      return { panes: nextPanes, openTabIds };
    });
  },

  closeAllTabs: () => {
    const state = get();
    // 共享 PTY 语义：所有 instance 归零时停 PTY。
    // 这里直接把 panes 清空,等价于所有 instance 归零,所以 unique tabId 全部需要 stop。
    const uniqueOpenIds = new Set<string>();
    for (const p of state.panes) for (const id of p.openTabIds) uniqueOpenIds.add(id);
    for (const id of uniqueOpenIds) {
      const session = state.sessions.find((s) => s.id === id);
      if (session?.isRunning) {
        stopSession(id).catch(() => {});
      }
      sessionUpdate(id, { isRunning: false, closedAt: Date.now() }).catch(() => {});
    }
    set({
      panes: [],
      activePaneId: null,
      openTabIds: [],
      activeTabId: null,
      sessions: state.sessions.map((s) =>
        uniqueOpenIds.has(s.id) ? { ...s, isRunning: false, closedAt: Date.now() } : s,
      ),
    });
    saveOpenTabIds([]);
  },

  closeTab: (id, paneId) => {
    const state = get();
    const session = state.sessions.find((s) => s.id === id);

    // 共享 PTY 语义：实例级关闭。
    // 默认关 activePane 中的实例（包含同 pane 内同 tabId 的防御性逻辑）；
    // 显式传 paneId 时关该 pane 的第一个 occurrence。

    // 计算"关闭后还剩多少实例"——只在归零时才停 PTY
    const targetPaneId = paneId ?? state.activePaneId ?? "";
    const willHaveInstances = (() => {
      let count = 0;
      for (const p of state.panes) {
        for (const tid of p.openTabIds) if (tid === id) count++;
      }
      // 减去这次即将关闭的 1 个（前提：targetPaneId 命中且该 pane 确实含该 id）
      const targetHit = state.panes.some(
        (p) => p.id === targetPaneId && p.openTabIds.includes(id),
      );
      return targetHit ? count - 1 : count;
    })();
    if (willHaveInstances === 0) {
      if (session?.isRunning) {
        stopSession(id).catch(() => {});
      }
      // 归零时写 closedAt 和 isRunning
      sessionUpdate(id, { isRunning: false, closedAt: Date.now() }).catch(() => {});
    }
    set((state) => {
      const sessions = willHaveInstances === 0
        ? state.sessions.map((s) =>
          s.id === id ? { ...s, isRunning: false, closedAt: Date.now() } : s,
        )
        : state.sessions;
      // 实例级移除：仅从目标 pane 移除第一个 occurrence
      const nextPanes: Pane[] = [];
      for (const p of state.panes) {
        if (p.id !== targetPaneId) {
          nextPanes.push(p);
          continue;
        }
        const idx = p.openTabIds.indexOf(id);
        if (idx < 0) {
          nextPanes.push(p);
          continue;
        }
        const nextOpen = [...p.openTabIds.slice(0, idx), ...p.openTabIds.slice(idx + 1)];
        if (nextOpen.length === 0) {
          // 该 pane 整体被清空 → 不入 nextPanes
          continue;
        }
        // 活动 tab 切换：
        //   - activeTabId !== id：保持
        //   - activeTabId === id 且剩余仍有该 occurrence：保持（仍能命中）
        //   - activeTabId === id 且没了：切到该 pane 最后一个
        const stillHasThisId = nextOpen.includes(id);
        const nextActive = p.activeTabId === id
          ? (stillHasThisId ? id : nextOpen[nextOpen.length - 1])
          : p.activeTabId;
        nextPanes.push({ ...p, openTabIds: nextOpen, activeTabId: nextActive });
      }
      const openTabIds = flattenPaneOpenIds(nextPanes);
      saveOpenTabIds(openTabIds);

      // 全局 activePaneId：若原 activePane 已被清掉，落到第一个剩余 pane；全部清空时为 null
      const activePaneStillExists = nextPanes.some((p) => p.id === state.activePaneId);
      const nextActivePaneId = activePaneStillExists
        ? state.activePaneId
        : (nextPanes[0]?.id ?? null);
      const activeTabId = paneActiveId(nextPanes, nextActivePaneId);
      return { sessions, panes: nextPanes, activePaneId: nextActivePaneId, openTabIds, activeTabId };
    });
  },

  openTab: async (id, opts) => {
    const state = get();
    // 共享 PTY 语义：允许同 tabId 出现在多个 pane。
    // 防御性：若目标 pane（默认 activePane）已含该 id，仅切焦点不再追加。
    // 例外：tab 已在 pane 中但 isRunning=false（之前启动失败留下的僵尸状态），
    // 必须继续走完整路径重新启动 PTY，否则用户看到"已打开但终端空白"且无法恢复。
    const targetPaneId = opts?.targetPaneId ?? state.activePaneId ?? state.panes[state.panes.length - 1]?.id;
    const targetSession = state.sessions.find((s) => s.id === id);
    const tabInTargetPane =
      targetPaneId && state.panes.some((p) => p.id === targetPaneId && p.openTabIds.includes(id));
    if (tabInTargetPane && targetSession?.isRunning) {
      set({ activePaneId: targetPaneId, activeTabId: id });
      return;
    }
    if (!targetSession) return;
    const session = targetSession;
    // 从 projects 查找 workDir
    const project = state.projects.find((p) => p.id === session.projectId);
    const envVars = parseEnvVars(session.envVars || "");

    // Claude Code 预检：若 DB 里的 cliSessionId 在本地 JSONL 不存在，
    // 说明用户已清理 ~/.claude/projects/<workdir>/<cliSessionId>.jsonl，
    // --resume 会失败 → 提前拒绝，由 UI 显示"会话被删除或不存在"。
    // 探测本身抛错时 fail-open：允许继续启动，让 Claude Code 报更明确的错误。
    if (session.toolType === "claude" && session.cliSessionId) {
      const workDir = project?.path || "~";
      const profile = session.profileId
        ? state.profiles.find((p) => p.id === session.profileId)
        : undefined;
      const claudeConfigDir = profile?.appDataRoot ?? null;
      try {
        const exists = await claudeJsonlExists(
          session.cliSessionId,
          workDir,
          claudeConfigDir,
        );
        if (!exists) {
          throw new Error("SESSION_DELETED");
        }
      } catch (e) {
        if (e instanceof Error && e.message === "SESSION_DELETED") throw e;
        // 其他错误（IPC 失败等）:放行,让 startSession 自己报
      }
    }

    // 重新打开 Claude Code 会话时恢复对话
    let cliArgs = session.cliArgs || "[]";
    let args: string[] = [];
    try { args = JSON.parse(cliArgs); } catch { /* ignore */ }
    // SSH 的 cli_args 是 JSON 对象（如 {"hostname":"...","port":22,...}），
    // JSON.parse 成功但 .some 不是函数会抛 TypeError,这里防御性规整为数组。
    // 同样避免空对象 / null 等被当成数组时静默抛错导致 openTab 整个 reject。
    if (!Array.isArray(args)) args = [];
    // 检查是否已有恢复参数
    const hasResume = args.some((a) => a === "--resume" || a === "-r");
    const hasContinue = args.some((a) => a === "--continue" || a === "-c");
    let willResumeSessionId: string | undefined;
    // Terminal / SSH 类型不支持 --resume/--continue，保持原样启动。
    // SSH 的 cli_args 是 JSON 对象（如 {"hostname":"...","port":22,...}），
    // 不能按 Vec<String> 反序列化，也不能注入 Claude 专属恢复参数。
    if (session.toolType !== "terminal" && session.toolType !== "ssh") {
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
    // 启动会话。CLI 启动失败时静默：终端会显示具体错误（如工作目录不存在、可执行文件缺失），
    // 重复探测/回退反而会污染用户看到的内容。
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
    }).catch(() => {});
    // 标记 isRunning，清除 closedAt
    sessionUpdate(id, { isRunning: true, closedAt: 0 }).catch(() => {});
    set((state) => {
      const sessions = state.sessions.map((s) =>
        s.id === id ? { ...s, isRunning: true, closedAt: undefined } : s,
      );
      // 目标 pane：显式 opts 优先，其次 activePane，最后 fallback 到 panes 末尾 / 新建
      const optsTarget = opts?.targetPaneId;
      const candidateId = optsTarget
        ?? state.activePaneId
        ?? state.panes[state.panes.length - 1]?.id;
      let nextPanes: Pane[];
      let nextActivePaneId: string | null;
      if (state.panes.some((p) => p.id === candidateId)) {
        // 防御性：目标 pane 已含该 id → 不重复 append（共享 PTY 语义要求同 pane 不重复）
        const targetPane = state.panes.find((p) => p.id === candidateId)!;
        if (targetPane.openTabIds.includes(id)) {
          return { sessions, activePaneId: candidateId, activeTabId: id };
        }
        nextPanes = state.panes.map((p) =>
          p.id === candidateId
            ? { ...p, openTabIds: [...p.openTabIds, id], activeTabId: id }
            : p,
        );
        nextActivePaneId = candidateId;
      } else {
        // panes 为空 或 activePaneId 指向不存在 pane → 按 candidateId（或新 uuid）新建 pane
        const newId = candidateId ?? crypto.randomUUID();
        const newPane: Pane = { id: newId, openTabIds: [id], activeTabId: id };
        nextPanes = [...state.panes, newPane];
        nextActivePaneId = newId;
      }
      const openTabIds = flattenPaneOpenIds(nextPanes);
      saveOpenTabIds(openTabIds);
      return { sessions, panes: nextPanes, activePaneId: nextActivePaneId, openTabIds, activeTabId: id };
    });
  },

  restoreTabs: () => {
    const state = get();
    // 1) 优先恢复分屏布局
    const persisted = loadPanesLayout();
    if (persisted) {
      // 过滤仍存在的 tab
      const validPanes: Pane[] = persisted.panes
        .map((p): Pane | null => {
          const openTabIds = p.openTabIds.filter((tid) => state.sessions.some((s) => s.id === tid));
          if (openTabIds.length === 0) return null;
          const activeTabId = p.activeTabId && openTabIds.includes(p.activeTabId)
            ? p.activeTabId
            : openTabIds[openTabIds.length - 1];
          return { id: p.id, openTabIds, activeTabId };
        })
        .filter((p): p is Pane => p !== null);
      if (validPanes.length === 0) {
        set({ openTabIds: [], activeTabId: null, panes: [], activePaneId: null });
        saveOpenTabIds([]);
        clearPanesLayout();
        return;
      }
      // 清空后按 pane 顺序逐个回放：activePaneId 指向不存在 pane 时，openTab 会按该 id 新建
      set({ openTabIds: [], activeTabId: null, panes: [], activePaneId: null });
      for (const p of validPanes) {
        // 预设 activePaneId = p.id（p.id 当前不在 panes 里），openTab 看到后会按这个 id 新建 pane
        set((s) => ({ ...s, activePaneId: p.id }));
        for (const tabId of p.openTabIds) {
          // 启动期静默吞掉 SESSION_DELETED：用户首次启动 app 不在屏幕前,
          // 立即弹"会话被删除"会骚扰；该 tab 会以"未打开"呈现,
          // 后续在侧边栏点击时会再次触发预检并正常提示。
          get().openTab(tabId).catch(() => {});
        }
      }
      // 最后切回保存的 activePaneId
      set({ activePaneId: persisted.activePaneId ?? validPanes[validPanes.length - 1].id });
      return;
    }

    // 2) 兼容旧版本：只持久化了 openTabIds
    const tabIds = state.openTabIds;
    if (tabIds.length === 0) return;
    const validIds = tabIds.filter((id) => state.sessions.some((s) => s.id === id));
    if (validIds.length === 0) {
      set({ openTabIds: [], activeTabId: null, panes: [], activePaneId: null });
      saveOpenTabIds([]);
      return;
    }
    set({ openTabIds: [], activeTabId: null, panes: [], activePaneId: null });
    for (const id of validIds) {
      get().openTab(id).catch(() => {});
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

  duplicateSession: async (id) => {
    const state = get();
    const src = state.sessions.find((s) => s.id === id);
    if (!src) return null;
    // 无标题时回落到工具显示名：副本必须与原会话在侧边树上可区分，
    // 否则两个同名行用户无从分辨哪个是刚复制出来的。
    const baseTitle = src.title || TOOL_DISPLAY_NAMES[src.toolType];
    // 刻意不复制 cliSessionId：共享同一个 Claude 会话 ID 会让两个标签页
    // --resume 到同一段对话，互相覆盖。副本应是一段全新对话。
    const newSession = await sessionCreate({
      projectId: src.projectId,
      toolType: src.toolType,
      title: `${baseTitle}-Copy`,
      profileId: src.profileId,
      color: src.color,
      thinkingIntensity: src.thinkingIntensity,
      templateId: src.templateId,
      cliArgs: src.cliArgs,
      envVars: src.envVars,
      categoryId: src.categoryId,
      llmProviderId: src.llmProviderId,
      modelName: src.modelName,
      claudeModels: serializeClaudeModels(src.claudeModels),
    });

    set((state) => {
      const sessions = [...state.sessions, newSession];
      // 把新 tab 加到当前活动 pane；若 activePaneId 指向不存在的 pane，按该 id 新建
      const candidateId = state.activePaneId ?? state.panes[state.panes.length - 1]?.id;
      let nextPanes: Pane[];
      let nextActivePaneId: string | null;
      if (state.panes.some((p) => p.id === candidateId)) {
        nextPanes = state.panes.map((p) =>
          p.id === candidateId
            ? { ...p, openTabIds: [...p.openTabIds, newSession.id], activeTabId: newSession.id }
            : p,
        );
        nextActivePaneId = candidateId;
      } else {
        const newId = candidateId ?? crypto.randomUUID();
        const newPane: Pane = { id: newId, openTabIds: [newSession.id], activeTabId: newSession.id };
        nextPanes = [...state.panes, newPane];
        nextActivePaneId = newId;
      }
      const openTabIds = flattenPaneOpenIds(nextPanes);
      saveOpenTabIds(openTabIds);
      return { sessions, panes: nextPanes, activePaneId: nextActivePaneId, openTabIds, activeTabId: newSession.id };
    });

    return newSession;
  },

  closeOtherTabs: (id) => {
    const state = get();
    // 找到 id 所在的任意一个 host pane(host pane 唯一,因为 openTab 防御性
    // 保证同 pane 内不重复,但跨 pane 双开时 id 可能在多个 pane 中)
    const hostPane = state.panes.find((p) => p.openTabIds.includes(id));
    if (!hostPane) return;

    // 共享 PTY 语义：先计算"被关闭的实例"和"剩余实例"。
    //   - 关闭 = 所有非 host pane 中 id 的 instance + host pane 内除 id 之外的 tab
    //   - 剩余 = host pane 中保留的 [id] 列表
    // 哪些 tabId 的所有 instance 归零:对每个被关闭的 tabId,若 hostPane.openTabIds 不含它,归零。
    const closedTabIds = new Set<string>();
    for (const p of state.panes) {
      if (p.id === hostPane.id) continue;
      for (const tid of p.openTabIds) closedTabIds.add(tid);
    }
    for (const tid of hostPane.openTabIds) {
      if (tid !== id) closedTabIds.add(tid);
    }
    for (const tid of closedTabIds) {
      // 若 host pane 还含该 tid,说明只是清掉其它 pane 的 instance,不算 0
      if (hostPane.openTabIds.includes(tid) && closedTabIds.has(tid) && tid !== id) {
        // host pane 内该 tid 也被清掉 → 归零
      }
      const s = state.sessions.find((sess) => sess.id === tid);
      if (s?.isRunning) stopSession(tid).catch(() => {});
      sessionUpdate(tid, { isRunning: false, closedAt: Date.now() }).catch(() => {});
    }
    set((state) => {
      const hostPaneNew: Pane = { id: hostPane.id, openTabIds: [id], activeTabId: id };
      const nextPanes = [hostPaneNew];
      const sessions = state.sessions.map((s) => {
        if (closedTabIds.has(s.id)) {
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
    // 共享 PTY 语义：每个 closingId 在 nextPanes 中只剩"本 pane 内 idx 之前 + 其他 pane 内的实例"
    // 这里 closingIds 都是从本 pane 内移除,只减少 1 个 instance;若该 tabId 在其他 pane 还有,
    // 不停 PTY,仅从该 pane 内移除(等下个 close 触发归零)
    closingIds.forEach((tid) => {
      const s = state.sessions.find((sess) => sess.id === tid);
      if (!s?.isRunning) return;
      // 计算"关闭本 pane 内这个 instance 后,该 tabId 还剩多少"
      const otherInstances = state.panes.reduce((acc, p) => {
        if (p.id === pane.id) return acc; // 即将全部移除(在 slice(0, idx+1) 后)
        return acc + p.openTabIds.filter((t) => t === tid).length;
      }, 0);
      if (otherInstances === 0) {
        stopSession(tid).catch(() => {});
        sessionUpdate(tid, { isRunning: false, closedAt: Date.now() }).catch(() => {});
      }
    });
    set((state) => {
      const nextPanes = state.panes.map((p) => {
        if (p.id !== pane.id) return p;
        const nextOpen = p.openTabIds.slice(0, idx + 1);
        const nextActive = p.activeTabId && !nextOpen.includes(p.activeTabId) ? id : p.activeTabId;
        return { ...p, openTabIds: nextOpen, activeTabId: nextActive };
      });
      // 只对"该 tabId 全 pane 归零"时标 isRunning=false（其他 pane 还有的 session 不动）
      const zeroedIds = new Set(
        closingIds.filter((tid) => instanceCount(nextPanes, tid) === 0),
      );
      const sessions = state.sessions.map((s) =>
        zeroedIds.has(s.id) ? { ...s, isRunning: false, closedAt: Date.now() } : s,
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

  manualGuideOpen: false,
  setManualGuideOpen: (open) => set({ manualGuideOpen: open }),

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

// 订阅：panes 或 activePaneId 变化时自动持久化分屏布局
useAppStore.subscribe((state, prev) => {
  if (state.panes !== prev.panes || state.activePaneId !== prev.activePaneId) {
    savePanesLayout(state.panes, state.activePaneId);
  }
});

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
