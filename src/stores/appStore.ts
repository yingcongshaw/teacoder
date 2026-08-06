import { create } from "zustand";
import type { CliTool, Profile, TerminalSettings, Project, Session, SessionTemplate } from "../types";
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
} from "../utils/ipc";

const OPEN_TABS_KEY = "codingtea_open_tabs";
const TERMINAL_SETTINGS_KEY = "codingtea_terminal_settings";

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
  }) => Promise<Session>;
  updateSession: (id: string, updates: Partial<Session>) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;

  // 已打开标签 ID 列表
  openTabIds: string[];
  activeTabId: string | null;

  closeTab: (id: string) => void;
  openTab: (id: string) => void;
  setActiveTab: (id: string | null) => void;
  duplicateSession: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  closeTabsToRight: (id: string) => void;

  favoriteTabs: string[];
  toggleFavorite: (tabId: string) => void;

  collapsedProjectIds: string[];
  toggleProjectCollapsed: (id: string) => void;

  newProjectModalOpen: boolean;
  setNewProjectModalOpen: (open: boolean) => void;
  newSessionModalOpen: boolean;
  newSessionProjectId: string | null;
  setNewSessionModalOpen: (open: boolean, projectId?: string | null) => void;

  sessionTemplates: SessionTemplate[];
  globalThinkingIntensity: string;
  setGlobalThinkingIntensity: (intensity: string) => void;

  profiles: Profile[];
  setProfiles: (profiles: Profile[]) => void;

  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  theme: string;
  setTheme: (theme: string) => void;

  compactMode: boolean;
  toggleCompactMode: () => void;

  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;

  settingsPage: boolean;
  setSettingsPage: (open: boolean) => void;

  costTick: number;
  setCostTick: (tick: number) => void;

  terminalSettings: TerminalSettings;
  updateTerminalSetting: <K extends keyof TerminalSettings>(key: K, value: TerminalSettings[K]) => void;
}

const FAVORITE_KEY = "codingtea_favorites";
const COLLAPSED_KEY = "codingtea_collapsed_projects";

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

const initialOpenTabIds = loadOpenTabIds();

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
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
      sessions: state.sessions.filter((s) => s.projectId !== id),
      openTabIds: state.openTabIds.filter((tid) => !relatedSessions.some((s) => s.id === tid)),
      activeTabId:
        relatedSessions.some((s) => s.id === state.activeTabId)
          ? state.openTabIds.filter((tid) => !relatedSessions.some((s) => s.id === tid)).slice(-1)[0] ?? null
          : state.activeTabId,
    }));
  },

  // 会话
  sessions: [],
  loadSessions: async () => {
    const sessions = await sessionList();
    set({ sessions });
  },
  createSession: async (input) => {
    const session = await sessionCreate(input);
    // 启动 CLI 进程
    const project = get().projects.find((p) => p.id === input.projectId);
    const envVars = parseEnvVars(input.envVars || "");
    await startSession({
      toolType: input.toolType,
      profileId: input.profileId || "",
      workDir: project?.path || "~",
      tabId: session.id,
      envVars,
      cliArgs: input.cliArgs,
    }).catch(() => {});
    const updatedSession = { ...session, isRunning: true };
    set((state) => ({
      sessions: [...state.sessions, updatedSession],
      openTabIds: [...state.openTabIds, session.id],
      activeTabId: session.id,
    }));
    saveOpenTabIds([...get().openTabIds, session.id]);
    return updatedSession;
  },
  updateSession: async (id, updates) => {
    const updated = await sessionUpdate(id, updates);
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, ...updated } : s)),
    }));
  },
  deleteSession: async (id) => {
    const session = get().sessions.find((s) => s.id === id);
    if (session?.isRunning) {
      stopSession(id).catch(() => {});
    }
    await sessionDelete(id);
    set((state) => {
      const openTabIds = state.openTabIds.filter((tid) => tid !== id);
      const activeTabId =
        state.activeTabId === id
          ? openTabIds.length > 0
            ? openTabIds[openTabIds.length - 1]
            : null
          : state.activeTabId;
      const favoriteTabs = state.favoriteTabs.filter((fid) => fid !== id);
      saveOpenTabIds(openTabIds);
      saveFavorites(favoriteTabs);
      return {
        sessions: state.sessions.filter((s) => s.id !== id),
        openTabIds,
        activeTabId,
        favoriteTabs,
      };
    });
  },

  openTabIds: initialOpenTabIds,
  activeTabId: initialOpenTabIds.length > 0
    ? initialOpenTabIds[initialOpenTabIds.length - 1]
    : null,

  closeTab: (id) => {
    const state = get();
    const session = state.sessions.find((s) => s.id === id);
    if (session?.isRunning) {
      stopSession(id).catch(() => {});
    }
    // 标记 closedAt 和 isRunning
    sessionUpdate(id, { isRunning: false, closedAt: Date.now() }).catch(() => {});
    set((state) => {
      const sessions = state.sessions.map((s) =>
        s.id === id ? { ...s, isRunning: false, closedAt: Date.now() } : s,
      );
      const openTabIds = state.openTabIds.filter((tid) => tid !== id);
      saveOpenTabIds(openTabIds);
      const activeTabId =
        state.activeTabId === id
          ? openTabIds.length > 0
            ? openTabIds[openTabIds.length - 1]
            : null
          : state.activeTabId;
      return { sessions, openTabIds, activeTabId };
    });
  },

  openTab: (id) => {
    const state = get();
    if (state.openTabIds.includes(id)) {
      set({ activeTabId: id });
      return;
    }
    const session = state.sessions.find((s) => s.id === id);
    if (!session) return;
    // 从 projects 查找 workDir
    const project = state.projects.find((p) => p.id === session.projectId);
    const envVars = parseEnvVars(session.envVars || "");
    startSession({
      toolType: session.toolType,
      profileId: session.profileId || "",
      workDir: project?.path || "~",
      tabId: id,
      envVars,
      cliArgs: session.cliArgs,
    }).catch(() => {});
    // 标记 isRunning
    sessionUpdate(id, { isRunning: true }).catch(() => {});
    set((state) => {
      const sessions = state.sessions.map((s) =>
        s.id === id ? { ...s, isRunning: true } : s,
      );
      const openTabIds = [...state.openTabIds, id];
      saveOpenTabIds(openTabIds);
      return { sessions, openTabIds, activeTabId: id };
    });
  },

  setActiveTab: (id) => set({ activeTabId: id }),

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
        const openTabIds = [...state.openTabIds, newSession.id];
        saveOpenTabIds(openTabIds);
        return { sessions, openTabIds, activeTabId: newSession.id };
      });
    }).catch(() => {});
  },

  closeOtherTabs: (id) => {
    const state = get();
    state.openTabIds
      .filter((tid) => tid !== id)
      .forEach((tid) => {
        const s = state.sessions.find((sess) => sess.id === tid);
        if (s?.isRunning) stopSession(tid).catch(() => {});
        sessionUpdate(tid, { isRunning: false, closedAt: Date.now() }).catch(() => {});
      });
    set((state) => {
      const openTabIds = [id];
      const sessions = state.sessions.map((s) =>
        state.openTabIds.includes(s.id) && s.id !== id
          ? { ...s, isRunning: false, closedAt: Date.now() }
          : s,
      );
      saveOpenTabIds(openTabIds);
      return { openTabIds, sessions, activeTabId: id };
    });
  },

  closeTabsToRight: (id) => {
    const state = get();
    const idx = state.openTabIds.indexOf(id);
    if (idx < 0) return;
    const closingIds = state.openTabIds.slice(idx + 1);
    closingIds.forEach((tid) => {
      const s = state.sessions.find((sess) => sess.id === tid);
      if (s?.isRunning) stopSession(tid).catch(() => {});
      sessionUpdate(tid, { isRunning: false, closedAt: Date.now() }).catch(() => {});
    });
    set((state) => {
      const openTabIds = state.openTabIds.slice(0, idx + 1);
      const sessions = state.sessions.map((s) =>
        closingIds.includes(s.id) ? { ...s, isRunning: false, closedAt: Date.now() } : s,
      );
      saveOpenTabIds(openTabIds);
      const activeTabId = openTabIds.includes(state.activeTabId || "")
        ? state.activeTabId
        : id;
      return { openTabIds, sessions, activeTabId };
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
      const collapsed = state.collapsedProjectIds.includes(id)
        ? state.collapsedProjectIds.filter((d) => d !== id)
        : [...state.collapsedProjectIds, id];
      saveCollapsed(collapsed);
      return { collapsedProjectIds: collapsed };
    }),

  newProjectModalOpen: false,
  setNewProjectModalOpen: (open) => set({ newProjectModalOpen: open }),
  newSessionModalOpen: false,
  newSessionProjectId: null,
  setNewSessionModalOpen: (open, projectId) =>
    set({ newSessionModalOpen: open, newSessionProjectId: open ? (projectId ?? null) : null }),

  sessionTemplates: BUILTIN_SESSION_TEMPLATES,
  globalThinkingIntensity: "medium",
  setGlobalThinkingIntensity: (intensity) => set({ globalThinkingIntensity: intensity }),

  profiles: [],
  setProfiles: (profiles) => set({ profiles }),

  sidebarCollapsed: false,
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  theme: "dark",
  setTheme: (theme) => set({ theme }),

  compactMode: false,
  toggleCompactMode: () =>
    set((state) => ({ compactMode: !state.compactMode })),

  searchOpen: false,
  setSearchOpen: (open) => set({ searchOpen: open }),

  settingsPage: false,
  setSettingsPage: (open) => set({ settingsPage: open }),

  costTick: 0,
  setCostTick: (tick) => set({ costTick: tick }),

  terminalSettings: loadTerminalSettings(),
  updateTerminalSetting: (key, value) =>
    set((state) => {
      const settings = { ...state.terminalSettings, [key]: value };
      saveTerminalSettings(settings);
      return { terminalSettings: settings };
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
