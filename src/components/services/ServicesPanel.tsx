import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button, Switch, Tooltip, App, Empty } from "antd";
import {
  DeleteOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ScanOutlined,
} from "@ant-design/icons";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "../../stores/appStore";
import {
  serviceDelete,
  serviceDetect,
  serviceList,
  serviceStart,
  serviceStates,
  serviceStop,
} from "../../utils/ipc";
import type { Service, ServiceRuntimeState } from "../../types";
import ServiceAddModal from "./ServiceAddModal";

interface ServicesPanelProps {
  visible: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

const LOG_MAX_LINES = 200;

export default function ServicesPanel({ visible, onClose, anchorRef }: ServicesPanelProps) {
  const { message } = App.useApp();
  const activeTabId = useAppStore((s) => s.activeTabId);
  const sessions = useAppStore((s) => s.sessions);
  const projects = useAppStore((s) => s.projects);

  const panelRef = useRef<HTMLDivElement>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [states, setStates] = useState<Record<string, ServiceRuntimeState>>({});
  const [logs, setLogs] = useState<Record<string, string[]>>({});
  const [allProjects, setAllProjects] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const activeSession = sessions.find((s) => s.id === activeTabId);
  const currentProjectId = activeSession?.projectId;

  const projectName = useMemo(() => {
    const map = new Map(projects.map((p) => [p.id, p.name]));
    return (id: string) => map.get(id) || "未知项目";
  }, [projects]);

  const reload = async () => {
    try {
      const list = await serviceList(allProjects ? undefined : currentProjectId);
      setServices(list);
    } catch (e) {
      message.error(`加载服务列表失败：${e}`);
    }
  };

  const reloadStates = async () => {
    try {
      const list = await serviceStates();
      const map: Record<string, ServiceRuntimeState> = {};
      for (const s of list) map[s.serviceId] = s;
      setStates(map);
    } catch {
      // 状态查询失败不影响列表显示
    }
  };

  useEffect(() => {
    if (!visible) return;
    void reload();
    void reloadStates();
  }, [visible, allProjects, currentProjectId]);

  // 进程输出与退出事件
  useEffect(() => {
    if (!visible) return;

    let dispose: (() => void) | undefined;
    let disposed = false;

    const unlistenOut = listen<{ serviceId: string; data: string }>("service:output", (e) => {
      const { serviceId, data } = e.payload;
      setLogs((prev) => {
        const lines = prev[serviceId] ? [...prev[serviceId], data] : [data];
        return {
          ...prev,
          [serviceId]: lines.length > LOG_MAX_LINES ? lines.slice(-LOG_MAX_LINES) : lines,
        };
      });
    });

    const unlistenExit = listen<{ serviceId: string }>("service:exit", () => {
      void reloadStates();
    });

    void unlistenOut.then(
      (fn) => {
        if (disposed) fn();
        else dispose = fn;
      },
      () => {},
    );
    void unlistenExit.then((fn) => fn(), () => {});

    return () => {
      disposed = true;
      dispose?.();
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;

    const handleClickOutside = (e: MouseEvent) => {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (
        anchor &&
        !anchor.contains(e.target as Node) &&
        panel &&
        !panel.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [visible, anchorRef, onClose]);

  const handleDetect = async () => {
    setDetecting(true);
    try {
      const scope = allProjects ? undefined : currentProjectId;
      if (!scope) {
        message.warning("当前没有所属项目，无法识别");
        return;
      }
      const result = await serviceDetect(scope);
      await reload();
      if (result.created.length === 0) {
        message.info("没有发现新的服务");
      } else {
        message.success(`识别到 ${result.created.length} 个新服务`);
      }
    } catch (e) {
      message.error(`服务识别失败：${e}`);
    } finally {
      setDetecting(false);
    }
  };

  const handleStart = async (service: Service) => {
    try {
      await serviceStart(service.id);
      await reloadStates();
    } catch (e) {
      message.error(`启动失败：${e}`);
    }
  };

  const handleStop = async (service: Service) => {
    try {
      await serviceStop(service.id);
      await reloadStates();
    } catch (e) {
      message.error(`停止失败：${e}`);
    }
  };

  const handleDelete = async (service: Service) => {
    try {
      await serviceDelete(service.id);
      await reload();
      await reloadStates();
      message.success("服务已删除");
    } catch (e) {
      message.error(`删除失败：${e}`);
    }
  };

  if (!visible) return null;

  const detectDisabled = !allProjects && !currentProjectId;

  return (
    <>
      <div
        ref={panelRef}
        className="absolute bottom-full mb-1 right-0 z-50 bg-[var(--ant-color-bg-elevated)] border border-[var(--ant-color-border)] rounded-lg shadow-lg w-[440px]"
        style={{ boxShadow: "0 6px 16px 0 rgba(0, 0, 0, 0.16)" }}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--ant-color-border-secondary)]">
          <Button
            size="small"
            icon={<PlusOutlined />}
            onClick={() => setAddOpen(true)}
            disabled={!allProjects && !currentProjectId}
          >
            添加服务
          </Button>
          <div className="flex items-center gap-2">
            <Switch
              size="small"
              checked={allProjects}
              onChange={setAllProjects}
              checkedChildren="所有项目"
              unCheckedChildren="本项目"
            />
            <Tooltip
              title={
                detectDisabled
                  ? "当前会话没有所属项目"
                  : allProjects
                    ? "识别所有项目的服务"
                    : "识别当前项目的服务"
              }
            >
              <Button
                size="small"
                icon={<ScanOutlined />}
                loading={detecting}
                disabled={detectDisabled}
                onClick={handleDetect}
              >
                服务识别
              </Button>
            </Tooltip>
          </div>
        </div>

        <div className="max-h-[300px] overflow-y-auto py-1">
          {services.length === 0 ? (
            <div className="py-6">
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有服务" />
            </div>
          ) : (
            services.map((service) => {
              const running = !!states[service.id]?.running;
              const expanded = expandedId === service.id;
              return (
                <div key={service.id} className="px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                      style={{
                        backgroundColor: running
                          ? "var(--ant-color-success)"
                          : "var(--ant-color-text-quaternary)",
                      }}
                    />
                    <span
                      className="text-xs cursor-pointer truncate"
                      style={{ color: "var(--ant-color-text)" }}
                      onClick={() => setExpandedId(expanded ? null : service.id)}
                      title={service.command}
                    >
                      {service.name}
                    </span>
                    {allProjects && (
                      <span className="text-xs text-[var(--ant-color-text-tertiary)] flex-shrink-0">
                        {projectName(service.projectId)}
                      </span>
                    )}
                    <span className="flex-1" />
                    <Button
                      size="small"
                      type="text"
                      icon={running ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
                      onClick={() => (running ? handleStop(service) : handleStart(service))}
                    />
                    <Button
                      size="small"
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => handleDelete(service)}
                    />
                  </div>
                  {expanded && (
                    <pre
                      className="mt-1 p-2 rounded text-xs whitespace-pre-wrap break-all max-h-[160px] overflow-y-auto"
                      style={{
                        backgroundColor: "var(--ant-color-fill-quaternary)",
                        color: "var(--ant-color-text-secondary)",
                      }}
                    >
                      {(logs[service.id] || []).join("") || "（暂无输出）"}
                    </pre>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <ServiceAddModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        defaultProjectId={currentProjectId}
        allowProjectSelect={allProjects}
      />
    </>
  );
}
