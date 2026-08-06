import { useEffect, useRef, useState } from "react";
import { ConfigProvider, theme as antdTheme, App as AntdApp } from "antd";
import zhCN from "antd/locale/zh_CN";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "../../stores/appStore";
import { detectCliTools, listProfiles, pollCosts, projectList, projectCreate, sessionCreate } from "../../utils/ipc";
import { resolveTheme } from "../../themes";
import useKeyboardShortcuts from "../../hooks/useKeyboardShortcuts";
import AppHeader from "./AppHeader";
import AppSidebar from "./AppSidebar";
import AppContent from "./AppContent";
import NewSessionModal from "../tabs/NewSessionModal";
import NewProjectModal from "../project/NewProjectModal";
import SearchPanel from "../tabs/SearchPanel";
import { AgreementModal, OnboardingGuide, useOnboarding } from "../onboarding/OnboardingFlow";

export default function AppLayout() {
  const appTheme = useAppStore((s) => s.theme);
  const compactMode = useAppStore((s) => s.compactMode);
  const setCliTools = useAppStore((s) => s.setCliTools);
  const setProfiles = useAppStore((s) => s.setProfiles);
  const newSessionModalOpen = useAppStore((s) => s.newSessionModalOpen);
  const setNewSessionModalOpen = useAppStore((s) => s.setNewSessionModalOpen);
  const newSessionProjectId = useAppStore((s) => s.newSessionProjectId);
  const newProjectModalOpen = useAppStore((s) => s.newProjectModalOpen);
  const setNewProjectModalOpen = useAppStore((s) => s.setNewProjectModalOpen);
  const loadProjects = useAppStore((s) => s.loadProjects);
  const loadSessions = useAppStore((s) => s.loadSessions);
  const sessions = useAppStore((s) => s.sessions);
  const setCostTick = useAppStore((s) => s.setCostTick);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const { ready, showAgreement, showGuide, completeAgreement, completeGuide, skipGuide } = useOnboarding();

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
    loadProjects()
      .then(async () => {
        // 迁移旧 localStorage 数据到后端
        const oldSessionsRaw = localStorage.getItem("codingtea_sessions");
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
              localStorage.removeItem("codingtea_sessions");
              localStorage.removeItem("codingtea_tabs");
            }
          } catch {
            // 迁移失败不影响启动
          }
        }
        loadSessions().catch(() => {});
      })
      .catch(() => {
        loadSessions().catch(() => {});
      });
  }, [setCliTools, setProfiles, loadProjects, loadSessions]);

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

  // Apply tailwind dark class
  useEffect(() => {
    const html = document.documentElement;
    if (themeConfig.tailwindClass === "dark") {
      html.classList.add("dark");
    } else {
      html.classList.remove("dark");
    }
  }, [themeConfig.tailwindClass]);

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm,
        token: compactToken,
      }}
    >
      <AntdApp>
        <div className="flex flex-col h-screen overflow-hidden bg-[#202023] text-[#e0e0e0]">
          {/* Top header */}
          <AppHeader />

          {/* Main area: sidebar + content side by side */}
          <div className="flex flex-1 min-h-0 overflow-hidden" style={{ flexDirection: "row" }}>
            {/* Left sidebar - fixed width */}
            <div className="flex-shrink-0 flex flex-col overflow-hidden border-r border-[#2a2d38] bg-[#202023]" style={{ width: 240 }}>
              <AppSidebar />
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
          onClose={() => setNewSessionModalOpen(false)}
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
          </>
        )}
      </AntdApp>
    </ConfigProvider>
  );
}
