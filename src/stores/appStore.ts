import { create } from "zustand";
import type { TabState, CliTool, Profile, TerminalSettings } from "../types";
import { DEFAULT_TERMINAL_SETTINGS } from "../types";
import { stopSession, startSession } from "../utils/ipc";

const SESSIONS_KEY = "codingtea_sessions";
const OPEN_TABS_KEY = "codingtea_open_tabs";
const TERMINAL_SETTINGS_KEY = "codingtea_terminal_settings";

function loadSessions(): TabState[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (raw) return JSON.parse(raw);
    // 迁移旧数据
    const oldRaw = localStorage.getItem("codingtea_tabs");
    if (oldRaw) {
      localStorage.setItem(SESSIONS_KEY, oldRaw);
      localStorage.removeItem("codingtea_tabs");
      return JSON.parse(oldRaw);
    }
    return [];
  } catch {
    return [];
  }
}

function saveSessions(sessions: TabState[]) {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  } catch {
    // storage full or unavailable — non-critical
  }
}

function loadOpenTabIds(): string[] {
  try {
    const raw = localStorage.getItem(OPEN_TABS_KEY);
    if (raw) return JSON.parse(raw);
    // 迁移：旧数据中所有 sessions 都视为已打开
    return loadSessions().map((s) => s.id);
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

  // 会话记录（持久化，关闭标签不影响）
  sessions: TabState[];
  // 已打开标签 ID 列表
  openTabIds: string[];
  activeTabId: string | null;

  createSession: (tab: TabState) => void;
  closeTab: (id: string) => void;
  openTab: (id: string) => void;
  deleteSession: (id: string) => void;
  setActiveTab: (id: string | null) => void;
  updateSession: (id: string, updates: Partial<TabState>) => void;
  duplicateSession: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  closeTabsToRight: (id: string) => void;

  favoriteTabs: string[];
  toggleFavorite: (tabId: string) => void;

  collapsedProjects: string[];
  toggleProjectCollapsed: (workDir: string) => void;

  profiles: Profile[];
  setProfiles: (profiles: Profile[]) => void;

  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  theme: string;
  setTheme: (theme: string) => void;

  compactMode: boolean;
  toggleCompactMode: () => void;

  newSessionModalOpen: boolean;
  setNewSessionModalOpen: (open: boolean) => void;

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

const initialSessions = loadSessions();
const initialOpenTabIds = loadOpenTabIds();

export const useAppStore = create<AppState>((set, get) => ({
  cliTools: [],
  setCliTools: (tools) => set({ cliTools: tools }),

  sessions: initialSessions,
  openTabIds: initialOpenTabIds,
  activeTabId: initialOpenTabIds.length > 0
    ? initialOpenTabIds[initialOpenTabIds.length - 1]
    : null,

  createSession: (tab) =>
    set((state) => {
      const sessions = [...state.sessions, tab];
      const openTabIds = [...state.openTabIds, tab.id];
      saveSessions(sessions);
      saveOpenTabIds(openTabIds);
      return { sessions, openTabIds, activeTabId: tab.id };
    }),

  closeTab: (id) => {
    const state = get();
    const session = state.sessions.find((s) => s.id === id);
    if (session?.isRunning) {
      stopSession(id).catch(() => {});
    }
    set((state) => {
      const sessions = state.sessions.map((s) =>
        s.id === id ? { ...s, isRunning: false, closedAt: Date.now() } : s,
      );
      const openTabIds = state.openTabIds.filter((tid) => tid !== id);
      saveSessions(sessions);
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
    // 重新启动 CLI 进程
    const envVars = parseEnvVars(session.envVars || "");
    const args = parseArgs(session.args || "");
    startSession({
      toolType: session.toolType,
      profileId: session.profileId || "",
      workDir: session.workDir || "~",
      tabId: id,
      envVars,
      args,
    }).catch(() => {});
    set((state) => {
      const sessions = state.sessions.map((s) =>
        s.id === id ? { ...s, isRunning: true } : s,
      );
      const openTabIds = [...state.openTabIds, id];
      saveSessions(sessions);
      saveOpenTabIds(openTabIds);
      return { sessions, openTabIds, activeTabId: id };
    });
  },

  deleteSession: (id) => {
    const state = get();
    const session = state.sessions.find((s) => s.id === id);
    if (session?.isRunning) {
      stopSession(id).catch(() => {});
    }
    set((state) => {
      const sessions = state.sessions.filter((s) => s.id !== id);
      const openTabIds = state.openTabIds.filter((tid) => tid !== id);
      saveSessions(sessions);
      saveOpenTabIds(openTabIds);
      const activeTabId =
        state.activeTabId === id
          ? openTabIds.length > 0
            ? openTabIds[openTabIds.length - 1]
            : null
          : state.activeTabId;
      const favoriteTabs = state.favoriteTabs.filter((fid) => fid !== id);
      saveFavorites(favoriteTabs);
      return { sessions, openTabIds, activeTabId, favoriteTabs };
    });
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  updateSession: (id, updates) =>
    set((state) => {
      const sessions = state.sessions.map((s) =>
        s.id === id ? { ...s, ...updates } : s,
      );
      saveSessions(sessions);
      return { sessions };
    }),

  duplicateSession: (id) =>
    set((state) => {
      const src = state.sessions.find((s) => s.id === id);
      if (!src) return state;
      const newId = crypto.randomUUID();
      const copy: TabState = {
        ...src,
        id: newId,
        title: src.title ? `${src.title} 副本` : "",
        isRunning: false,
      };
      const idx = state.sessions.findIndex((s) => s.id === id);
      const sessions = [...state.sessions.slice(0, idx + 1), copy, ...state.sessions.slice(idx + 1)];
      const openTabIds = [...state.openTabIds, newId];
      saveSessions(sessions);
      saveOpenTabIds(openTabIds);
      return { sessions, openTabIds, activeTabId: newId };
    }),

  closeOtherTabs: (id) => {
    const state = get();
    state.openTabIds
      .filter((tid) => tid !== id)
      .forEach((tid) => {
        const s = state.sessions.find((sess) => sess.id === tid);
        if (s?.isRunning) stopSession(tid).catch(() => {});
      });
    set((state) => {
      const openTabIds = [id];
      const sessions = state.sessions.map((s) =>
        state.openTabIds.includes(s.id) && s.id !== id
          ? { ...s, isRunning: false, closedAt: Date.now() }
          : s,
      );
      saveOpenTabIds(openTabIds);
      saveSessions(sessions);
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
    });
    set((state) => {
      const openTabIds = state.openTabIds.slice(0, idx + 1);
      const sessions = state.sessions.map((s) =>
        closingIds.includes(s.id) ? { ...s, isRunning: false, closedAt: Date.now() } : s,
      );
      saveOpenTabIds(openTabIds);
      saveSessions(sessions);
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

  collapsedProjects: loadCollapsed(),
  toggleProjectCollapsed: (workDir) =>
    set((state) => {
      const collapsed = state.collapsedProjects.includes(workDir)
        ? state.collapsedProjects.filter((d) => d !== workDir)
        : [...state.collapsedProjects, workDir];
      saveCollapsed(collapsed);
      return { collapsedProjects: collapsed };
    }),

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

  newSessionModalOpen: false,
  setNewSessionModalOpen: (open) => set({ newSessionModalOpen: open }),

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

function parseArgs(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}
