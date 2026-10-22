import { useEffect, useRef, useState, useCallback } from "react";
import { ConfigProvider, theme as antdTheme, App as AntdApp } from "antd";
import zhCN from "antd/locale/zh_CN";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "../../stores/appStore";
import { detectCliTools, listProfiles, pollCosts, projectList, projectCreate, sessionCreate } from "../../utils/ipc";
import { resolveTheme, buildTextTokens, buildBgTokens } from "../../themes";
import { buildUiFontStack } from "../../utils/font";
import useKeyboardShortcuts from "../../hooks/useKeyboardShortcuts";
import AppHeader from "./AppHeader";
import AppSidebar from "./AppSidebar";
import AppContent from "./AppContent";
import NewSessionModal from "../tabs/NewSessionModal";
import EditSessionModal from "../tabs/EditSessionModal";
import NewProjectModal from "../project/NewProjectModal";
import NewCategoryModal from "../project/NewCategoryModal";
import SearchPanel from "../tabs/SearchPanel";
import { AgreementModal, OnboardingGuide, useOnboarding } from "../onboarding/OnboardingFlow";

export default function AppLayout() {
  const appTheme = useAppStore((s) => s.theme);
  const fontSize = useAppStore((s) => s.fontSize);
  const uiFontFamily = useAppStore((s) => s.uiFontFamily);
  const uiZoom = useAppStore((s) => s.uiZoom);
  const compactMode = useAppStore((s) => s.compactMode);
  const setCliTools = useAppStore((s) => s.setCliTools);
  const setProfiles = useAppStore((s) => s.setProfiles);
  const newSessionModalOpen = useAppStore((s) => s.newSessionModalOpen);
  const setNewSessionModalOpen = useAppStore((s) => s.setNewSessionModalOpen);
  const newSessionProjectId = useAppStore((s) => s.newSessionProjectId);
  const newSessionCategoryId = useAppStore((s) => s.newSessionCategoryId);
  const newProjectModalOpen = useAppStore((s) => s.newProjectModalOpen);
  const setNewProjectModalOpen = useAppStore((s) => s.setNewProjectModalOpen);
  const newCategoryModalOpen = useAppStore((s) => s.newCategoryModalOpen);
  const setNewCategoryModalOpen = useAppStore((s) => s.setNewCategoryModalOpen);
  const newCategoryProjectId = useAppStore((s) => s.newCategoryProjectId);
  const editSessionModalOpen = useAppStore((s) => s.editSessionModalOpen);
  const setEditSessionModalOpen = useAppStore((s) => s.setEditSessionModalOpen);
  const editingSessionId = useAppStore((s) => s.editingSessionId);
  const setSettingsPage = useAppStore((s) => s.setSettingsPage);
  const setSettingsActiveKey = useAppStore((s) => s.setSettingsActiveKey);
  const manualGuideOpen = useAppStore((s) => s.manualGuideOpen);
  const setManualGuideOpen = useAppStore((s) => s.setManualGuideOpen);
  const loadProjects = useAppStore((s) => s.loadProjects);
  const loadSessions = useAppStore((s) => s.loadSessions);
  const loadCategories = useAppStore((s) => s.loadCategories);
  const loadLlmProviders = useAppStore((s) => s.loadLlmProviders);
  const restoreTabs = useAppStore((s) => s.restoreTabs);
  const sessions = useAppStore((s) => s.sessions);
  const setCostTick = useAppStore((s) => s.setCostTick);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const { ready, showAgreement, showGuide, completeAgreement, completeGuide, skipGuide } = useOnboarding();

  // 左侧栏目宽度拖拽调整
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [isDragging, setIsDragging] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      // 计算新的宽度，考虑父容器边界
      const containerRect = sidebarRef.current?.parentElement?.getBoundingClientRect();
      if (!containerRect) return;

      // 使用鼠标位置计算新宽度，限制范围 180-500
      const newWidth = Math.min(500, Math.max(180, e.clientX - containerRect.left));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  useKeyboardShortcuts();

  // Listen for system theme changes
  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemDark(mql.matches);
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    detectCliTools()
      .then(setCliTools)
      .catch(() => {});
    listProfiles()
      .then(setProfiles)
      .catch(() => {});

    // 迁移旧数据并加载会话
    const initApp = async () => {
      try {
        // 迁移旧 localStorage 数据到后端
        const oldSessionsRaw = localStorage.getItem("teacoder_sessions");
        if (oldSessionsRaw) {
          try {
            const oldSessions = JSON.parse(oldSessionsRaw);
            if (Array.isArray(oldSessions) && oldSessions.length > 0) {
              const existingProjects = await projectList();
              if (existingProjects.length === 0) {
                const workDirs = new Set<string>();
                for (const s of oldSessions) {
                  if (s.workDir) workDirs.add(s.workDir);
                }
                for (const workDir of workDirs) {
                  const name = workDir.split(/[/\\]/).pop() || workDir;
                  await projectCreate({ name, path: workDir });
                }
                const projects = await projectList();
                for (const s of oldSessions) {
                  const project = projects.find((p) => p.path === (s.workDir || "~"));
                  if (project) {
                    await sessionCreate({
                      projectId: project.id,
                      toolType: s.toolType,
                      title: s.title || undefined,
                      profileId: s.profileId || undefined,
                      color: s.color || undefined,
                      envVars: s.envVars || undefined,
                    });
                  }
                }
              }
              localStorage.removeItem("teacoder_sessions");
              localStorage.removeItem("teacoder_tabs");
            }
          } catch {
            // 迁移失败不影响启动
          }
        }
      } catch {
        // 项目加载失败不影响后续
      }

      // 加载项目和会话
      await loadProjects();
      await loadSessions();
      await loadCategories();
      await loadLlmProviders();

      // 检查"启动时恢复上次会话"设置
      try {
        const raw = localStorage.getItem("teacoder_general_settings");
        const settings = raw ? JSON.parse(raw) : {};
        if (settings.restoreOnStartup !== false) {
          restoreTabs();
        } else {
          // 设置为不恢复时，清空已加载的 Tab 状态
          useAppStore.getState().closeAllTabs();
        }
      } catch {
        restoreTabs();
      }
    };

    initApp().catch(() => {});
  }, [setCliTools, setProfiles, loadProjects, loadSessions, loadCategories, loadLlmProviders, restoreTabs]);

  // 30s cost polling when sessions are running
  useEffect(() => {
    const hasRunning = sessions.some((s) => s.isRunning);
    if (hasRunning && !timerRef.current) {
      pollCosts().catch(() => {});
      timerRef.current = setInterval(() => {
        pollCosts().catch(() => {});
      }, 30_000);
    } else if (!hasRunning && timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [sessions]);

  // Listen for cost:updated events from backend
  useEffect(() => {
    const unlisten = listen("cost:updated", () => {
      setCostTick(Date.now());
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [setCostTick]);

  // 托盘"关于"菜单：打开设置面板并跳转到关于页
  useEffect(() => {
    const unlisten = listen("settings:open-about", () => {
      setSettingsActiveKey("about");
      setSettingsPage(true);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [setSettingsPage, setSettingsActiveKey]);

  // Resolve theme configuration
  const themeConfig = resolveTheme(appTheme, systemDark);
  const algorithm =
    themeConfig.algorithm === "dark"
      ? antdTheme.darkAlgorithm
      : antdTheme.defaultAlgorithm;

  // Compact mode token overrides
  const compactToken = compactMode
    ? {
        borderRadius: 4,
        borderRadiusSM: 2,
        borderRadiusLG: 6,
        padding: 12,
        paddingSM: 8,
        paddingXS: 4,
        paddingLG: 16,
        controlHeight: 28,
        controlHeightSM: 22,
        controlHeightLG: 32,
        fontSize: 13,
        fontSizeSM: 12,
        ...themeConfig.token,
      }
    : themeConfig.token;

  // Ant Design 主题使用与全局一致的字体栈
  const themeFontFamily = `var(--ui-font-family)`;

  // Apply tailwind dark class
  useEffect(() => {
    const html = document.documentElement;
    if (themeConfig.tailwindClass === "dark") {
      html.classList.add("dark");
    } else {
      html.classList.remove("dark");
    }
  }, [themeConfig.tailwindClass]);

  // Apply font size, font family and UI zoom CSS variables
  useEffect(() => {
    const html = document.documentElement;
    html.style.setProperty("--ui-font-size", `${fontSize}px`);
    html.style.setProperty(
      "--ui-font-family",
      buildUiFontStack(uiFontFamily),
    );
    html.style.setProperty("--ui-zoom", `${uiZoom / 100}`);
  }, [fontSize, uiFontFamily, uiZoom]);

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm,
        token: {
          fontFamily: themeFontFamily,
          ...compactToken,
          ...buildTextTokens(themeConfig.token),
          ...buildBgTokens(themeConfig.token),
        },
      }}
      getPopupContainer={() => document.getElementById("root") || document.body}
    >
      <AntdApp>
        <div className="flex flex-col h-screen overflow-hidden bg-[var(--ant-color-bg-container)] text-[var(--ant-color-text)] rounded-[10px]">
          {/* Top header */}
          <AppHeader />

          {/* Main area: sidebar + content side by side */}
          <div className="flex flex-1 min-h-0 overflow-hidden" style={{ flexDirection: "row" }}>
            {/* Left sidebar - resizable width */}
            <div
              ref={sidebarRef}
              className="flex-shrink-0 flex flex-col overflow-hidden bg-[var(--ant-color-bg-container)]"
              style={{ width: sidebarWidth }}
            >
              <AppSidebar />
            </div>

            {/* Resizable divider */}
            <div
              className={`w-1 flex-shrink-0 cursor-col-resize relative group ${isDragging ? "bg-[var(--ant-color-primary)]" : "bg-[var(--ant-color-border-secondary)] hover:bg-[var(--ant-color-primary)]"}`}
              style={{ cursor: isDragging ? "col-resize" : "col-resize" }}
              onMouseDown={handleMouseDown}
            >
              {/* 拖动提示线 */}
              <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-transparent group-hover:bg-[var(--ant-color-primary)] transition-colors" />
            </div>

            {/* Right content area */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
              <AppContent />
            </div>
          </div>
        </div>
        <NewProjectModal
          open={newProjectModalOpen}
          onClose={() => setNewProjectModalOpen(false)}
        />
        <NewSessionModal
          open={newSessionModalOpen}
          projectId={newSessionProjectId}
          categoryId={newSessionCategoryId}
          onClose={() => setNewSessionModalOpen(false)}
        />
        <EditSessionModal
          open={editSessionModalOpen}
          sessionId={editingSessionId}
          onClose={() => setEditSessionModalOpen(false)}
        />
        <NewCategoryModal
          open={newCategoryModalOpen}
          projectId={newCategoryProjectId}
          onClose={() => setNewCategoryModalOpen(false)}
        />
        <SearchPanel />
        {ready && (
          <>
            <AgreementModal open={showAgreement} onAccept={completeAgreement} />
            <OnboardingGuide
              open={showGuide}
              onComplete={completeGuide}
              onSkip={skipGuide}
            />
            {/* 通过顶部"帮助"按钮主动打开的引导：只关 modal，不动完成标记 */}
            <OnboardingGuide
              open={manualGuideOpen}
              onComplete={() => setManualGuideOpen(false)}
              onSkip={() => setManualGuideOpen(false)}
            />
          </>
        )}
      </AntdApp>
    </ConfigProvider>
  );
}
