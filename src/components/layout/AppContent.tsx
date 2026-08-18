import { useState, useRef, useCallback, useEffect } from "react";
import { Button, Tooltip, Modal } from "antd";
import {
  FolderOutlined,
  PlusOutlined,
  PlayCircleOutlined,
  DeleteOutlined,
  ClockCircleOutlined,
  CloseOutlined,
  DollarOutlined,
} from "@ant-design/icons";
import { useAppStore } from "../../stores/appStore";
import TerminalView from "../terminal/TerminalView";
import TabBar from "../tabs/TabBar";
import SettingsPage from "./SettingsPage";
import CostDashboard from "../cost/CostDashboard";
import { TOOL_DISPLAY_NAMES } from "../../types";
import { getGlobalCost } from "../../utils/ipc";
import type { CostSummary } from "../../types";

const TOOL_COLORS: Record<string, string> = {
  claude: "#9254de",
  codex: "#549cd8",
  gemini: "#549cd8",
  opencode: "#ffa940",
};

export default function AppContent() {
  const sessions = useAppStore((s) => s.sessions);
  const projects = useAppStore((s) => s.projects);
  const openTabIds = useAppStore((s) => s.openTabIds);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const activeTab = sessions.find((s) => s.id === activeTabId);
  const setNewSessionModalOpen = useAppStore((s) => s.setNewSessionModalOpen);
  const setNewProjectModalOpen = useAppStore((s) => s.setNewProjectModalOpen);
  const deleteSession = useAppStore((s) => s.deleteSession);
  const openTab = useAppStore((s) => s.openTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const settingsPage = useAppStore((s) => s.settingsPage);
  const setSettingsPage = useAppStore((s) => s.setSettingsPage);

  const [hoveredCardId, setHoveredCardId] = useState<string | null>(null);
  const [costModalOpen, setCostModalOpen] = useState(false);
  const [globalCost, setGlobalCost] = useState<CostSummary | null>(null);
  const costTick = useAppStore((s) => s.costTick);

  useEffect(() => {
    getGlobalCost().then(setGlobalCost).catch(() => {});
  }, [costTick]);

  const formatCost = (usd: number): string => {
    if (usd >= 1) return `$${usd.toFixed(2)}`;
    if (usd >= 0.01) return `$${usd.toFixed(3)}`;
    if (usd > 0) return `$${usd.toFixed(4)}`;
    return "$0";
  };

  const mainContent = (() => {
    // 有已打开的标签时，显示终端
    if (activeTab && openTabIds.length > 0) {
      return (
        <div className="flex-1 flex flex-col min-w-0 bg-[var(--ant-color-bg-container)]">
          <TabBar />
          <div className="flex-1 relative overflow-hidden min-h-0">
            {openTabIds.map((tabId) => {
              const session = sessions.find((s) => s.id === tabId);
              if (!session) return null;
              return (
                <div
                  key={tabId}
                  className="absolute inset-0"
                  style={{
                    visibility: tabId === activeTabId ? "visible" : "hidden",
                    zIndex: tabId === activeTabId ? 1 : 0,
                  }}
                >
                  <TerminalView tabId={tabId} visible={tabId === activeTabId} />
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    // 首页：卡片网格
    return (
      <div className="flex-1 flex flex-col min-w-0 bg-[var(--ant-color-bg-layout)]">
        {/* Section header */}
        <div className="px-8 pt-6 pb-4 flex items-center justify-between">
          <h2 className="text-base font-medium text-[var(--ant-color-text)] m-0">最近会话</h2>
        </div>

        {/* Card grid */}
        <div className="flex-1 overflow-y-auto px-8 pb-8">
          {sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-6">
              <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-[var(--ant-color-primary)] to-[#722ed1] flex items-center justify-center text-white text-3xl font-bold shadow-lg">
                茶
              </div>
              <div className="text-center">
                <p className="text-[var(--ant-color-text-secondary)] text-sm mb-4">
                  暂无会话，先创建一个项目
                </p>
                <button
                  onClick={() => setNewProjectModalOpen(true)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-[var(--ant-color-primary)] text-white rounded-lg hover:opacity-90 transition-colors text-sm shadow-sm"
                >
                  <PlusOutlined />
                  新建项目
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {sessions.map((session) => {
                const isHovered = hoveredCardId === session.id;
                const toolColor = TOOL_COLORS[session.toolType] || "var(--ant-color-text-tertiary)";
                const isOpen = openTabIds.includes(session.id);

                return (
                  <div
                    key={session.id}
                    className="rounded-lg border p-5 cursor-pointer transition-all"
                    style={{
                      backgroundColor: isHovered ? "var(--ant-color-bg-elevated)" : "var(--ant-color-bg-container)",
                      borderColor: isHovered ? "var(--ant-color-border)" : "var(--ant-color-border-secondary)",
                      boxShadow: isHovered
                        ? "0 4px 12px rgba(0,0,0,0.15)"
                        : "0 1px 3px rgba(0,0,0,0.08)",
                    }}
                    onClick={() => {
                      if (isOpen) {
                        setActiveTab(session.id);
                      } else {
                        openTab(session.id);
                      }
                    }}
                    onMouseEnter={() => setHoveredCardId(session.id)}
                    onMouseLeave={() => setHoveredCardId(null)}
                  >
                    {/* Card header: title + tool type */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span
                          className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: session.color || toolColor }}
                        />
                        <span className="text-sm font-medium text-[var(--ant-color-text)] truncate">
                          {session.title || TOOL_DISPLAY_NAMES[session.toolType]}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        {isOpen && (
                          <span className="text-[10px] text-[var(--ant-color-primary)]">已打开</span>
                        )}
                        <span
                          className="text-xs"
                          style={{ color: toolColor }}
                        >
                          {TOOL_DISPLAY_NAMES[session.toolType]}
                        </span>
                      </div>
                    </div>

                    {/* Project */}
                    <div className="flex items-center gap-1.5 text-xs text-[var(--ant-color-text-secondary)] mb-3">
                      <FolderOutlined style={{ fontSize: 11 }} />
                      <span className="truncate">
                        {projects.find((p) => p.id === session.projectId)?.name || "未知项目"}
                      </span>
                    </div>

                    {/* Bottom row: timestamp + actions */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1 text-xs text-[var(--ant-color-text-tertiary)]">
                        <ClockCircleOutlined style={{ fontSize: 11 }} />
                        <span>
                          {session.createdAt
                            ? new Date(session.createdAt).toLocaleDateString("zh-CN")
                            : "--"}
                        </span>
                        {session.isRunning && (
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--ant-color-success)] ml-2" style={{ animation: "pulse-dot 2s ease-in-out infinite" }} />
                        )}
                      </div>

                      {/* Action buttons - visible on hover */}
                      <div
                        className="flex items-center gap-0.5 transition-opacity duration-150"
                        style={{ opacity: isHovered ? 1 : 0 }}
                      >
                        <Tooltip title={isOpen ? "切换到" : "打开"}>
                          <Button
                            type="text"
                            size="small"
                            icon={<PlayCircleOutlined style={{ fontSize: 12, color: "var(--ant-color-text-secondary)" }} />}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isOpen) {
                                setActiveTab(session.id);
                              } else {
                                openTab(session.id);
                              }
                            }}
                            style={{ width: 24, height: 24, padding: 0, minWidth: 24 }}
                          />
                        </Tooltip>
                        <Tooltip title="删除">
                          <Button
                            type="text"
                            size="small"
                            icon={<DeleteOutlined style={{ fontSize: 12, color: "var(--ant-color-text-secondary)" }} />}
                            onClick={(e) => {
                              e.stopPropagation();
                              Modal.confirm({
                                title: "删除会话",
                                content: "确认删除此会话记录？此操作不可恢复。",
                                okText: "删除",
                                cancelText: "取消",
                                okButtonProps: { danger: true },
                                onOk: () => deleteSession(session.id),
                              });
                            }}
                            style={{ width: 24, height: 24, padding: 0, minWidth: 24 }}
                          />
                        </Tooltip>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* New session card */}
              <div
                className="rounded-lg border border-dashed p-5 cursor-pointer transition-all flex flex-col items-center justify-center gap-2 min-h-[130px]"
                style={{
                  backgroundColor: "var(--ant-color-bg-container)",
                  borderColor: "var(--ant-color-border)",
                }}
                onClick={() => setNewSessionModalOpen(true)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--ant-color-primary)";
                  e.currentTarget.style.backgroundColor = "var(--ant-color-bg-elevated)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--ant-color-border)";
                  e.currentTarget.style.backgroundColor = "var(--ant-color-bg-container)";
                }}
              >
                <PlusOutlined style={{ fontSize: 20, color: "var(--ant-color-text-secondary)" }} />
                <span className="text-xs text-[var(--ant-color-text-secondary)]">新建会话</span>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  })();

  return (
    <>
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {mainContent}
        {/* Bottom cost bar */}
        <div className="flex-shrink-0 border-t border-[var(--ant-color-border)] bg-[var(--ant-color-bg-container)]">
          <div
            className="flex items-center justify-between px-3 py-1.5 cursor-pointer transition-colors"
            style={{ backgroundColor: "var(--ant-color-bg-container)" }}
            onClick={() => setCostModalOpen(true)}
          >
            <div className="flex items-center gap-2 text-xs" style={{ color: "var(--ant-color-text-secondary)" }}>
              <DollarOutlined style={{ fontSize: 12 }} />
              <span>费用统计</span>
              {globalCost && globalCost.costUsd > 0 && (
                <span style={{ color: "var(--ant-color-text)" }}>{formatCost(globalCost.costUsd)}</span>
              )}
            </div>
          </div>
        </div>
      </div>
      <DraggableModal
        open={settingsPage}
        onClose={() => setSettingsPage(false)}
        title="设置"
      >
        <SettingsPage />
      </DraggableModal>
      <DraggableModal
        open={costModalOpen}
        onClose={() => setCostModalOpen(false)}
        title="费用统计"
      >
        <CostDashboard />
      </DraggableModal>
    </>
  );
}

function DraggableModal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  useEffect(() => {
    if (!dragging) return;

    const handleMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setOffset({
        x: dragStart.current.ox + dx,
        y: dragStart.current.oy + dy,
      });
    };

    const handleUp = () => {
      setDragging(false);
    };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
    return () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };
  }, [dragging]);

  const onTitleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("button, input, select, textarea, [role='menu']")) return;
      e.preventDefault();
      setDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    },
    [offset],
  );

  if (!open) return null;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0, 0, 0, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 10,
        overflow: "hidden",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: "64%",
          maxWidth: 960,
          height: "64vh",
          background: "var(--ant-color-bg-layout, #141414)",
          borderRadius: 8,
          boxShadow: "0 6px 16px 0 rgba(0, 0, 0, 0.08), 0 3px 6px -4px rgba(0, 0, 0, 0.12), 0 9px 28px 8px rgba(0, 0, 0, 0.05)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          transform: `translate(${offset.x}px, ${offset.y}px)`,
          transition: dragging ? "none" : "transform 0.1s",
        }}
      >
        {/* Title bar - draggable area */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 12px 8px 16px",
            borderBottom: "1px solid var(--ant-color-border-secondary, #424242)",
            background: "var(--ant-color-bg-container, #1f1f1f)",
            cursor: "move",
            userSelect: "none",
          }}
          onMouseDown={onTitleMouseDown}
        >
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ant-color-text)" }}>
            {title}
          </span>
          <button
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              cursor: "pointer",
              padding: "4px 8px",
              borderRadius: 4,
              color: "var(--ant-color-text-secondary)",
              fontSize: 14,
              lineHeight: 1,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--ant-color-fill-quaternary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <CloseOutlined />
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: "hidden" }}>
          {children}
        </div>
      </div>
    </div>
  );
}
