import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Switch, Tooltip, App, Empty, Modal, Input } from "antd";
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
  serviceRename,
  serviceStart,
  serviceStates,
  serviceStop,
} from "../../utils/ipc";
import type { Service, ServiceRuntimeState } from "../../types";
import { openExternal } from "../../utils/openExternal";
import { DEV_KIND_COLORS, devKindShort } from "../../utils/devEnvKinds";
import ServiceAddModal from "./ServiceAddModal";

interface ServicesPanelProps {
  visible: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

const LOG_MAX_LINES = 200;

/** 服务行的列宽：状态点 | 环境标识 | 名称 | 项目 | 端口 | 弹性留白 | 启停 | 删除。 */
const GRID_COLUMNS = "8px 40px 120px 90px 80px 1fr 28px 28px";

/** 行尾两个图标按钮统一成方块，图标才会上下对齐成一列。 */
const ICON_BUTTON_STYLE: React.CSSProperties = {
  width: 28,
  height: 28,
  padding: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

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
  const [renameTarget, setRenameTarget] = useState<Service | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Service | null>(null);

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

  const reloadStates = useCallback(async () => {
    try {
      const list = await serviceStates();
      const map: Record<string, ServiceRuntimeState> = {};
      for (const s of list) map[s.serviceId] = s;
      setStates(map);
    } catch {
      // 状态查询失败不影响列表显示
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    void reload();
    void reloadStates();
  }, [visible, allProjects, currentProjectId]);

  // 端口要等服务真的把端口绑上才探测得到，面板开着就定期问一次
  useEffect(() => {
    if (!visible) return;
    const timer = window.setInterval(() => {
      void reloadStates();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [visible, reloadStates]);

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

    // 「添加服务」「改名」弹窗渲染在 body 的 portal 里，不在面板 DOM 内。
    // 它们开着的时候不能让面板的「点外部关闭」把面板一起收掉。
    const handleClickOutside = (e: MouseEvent) => {
      if (addOpen || renameTarget || deleteTarget) return;
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
      if (addOpen || renameTarget || deleteTarget) return;
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [visible, anchorRef, onClose, addOpen, renameTarget, deleteTarget]);

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

  const handleDelete = (service: Service) => {
    setDeleteTarget(service);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const service = deleteTarget;
    try {
      await serviceDelete(service.id);
      setDeleteTarget(null);
      await reload();
      await reloadStates();
      message.success("服务已删除");
    } catch (e) {
      message.error(`删除失败：${e}`);
    }
  };

  const openRename = (service: Service) => {
    setRenameTarget(service);
    setRenameValue(service.name);
  };

  const handleRename = async () => {
    if (!renameTarget) return;
    const name = renameValue.trim();
    if (!name) {
      message.warning("服务名称不能为空");
      return;
    }
    try {
      await serviceRename(renameTarget.id, name);
      setRenameTarget(null);
      await reload();
      message.success("服务已改名");
    } catch (e) {
      message.error(`改名失败：${e}`);
    }
  };

  if (!visible) return null;

  const detectDisabled = !allProjects && !currentProjectId;

  return (
    <>
      <div
        ref={panelRef}
        className="absolute bottom-full mb-1 left-0 z-50 bg-[var(--ant-color-bg-elevated)] border border-[var(--ant-color-border)] rounded-lg shadow-lg w-[460px]"
        style={{ boxShadow: "0 6px 16px 0 rgba(0, 0, 0, 0.16)" }}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--ant-color-border-secondary)]">
          <Switch
            size="small"
            checked={allProjects}
            onChange={setAllProjects}
            checkedChildren="所有项目"
            unCheckedChildren="本项目"
          />
          <div className="flex items-center gap-2">
            <Tooltip title="添加服务">
              <Button
                size="small"
                icon={<PlusOutlined />}
                onClick={() => setAddOpen(true)}
                disabled={!allProjects && !currentProjectId}
                aria-label="添加服务"
                style={{ fontSize: 12 }}
              />
            </Tooltip>
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
                aria-label="服务识别"
                style={{ fontSize: 12 }}
              />
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
                  {/* 用网格排版，各列宽度写死 —— 环境标识的字数不一样，
                      用弹性布局的话后面的端口、项目、按钮会跟着漂。
                      项目列不显示时也留着空位，端口列的位置才不会跟着变。 */}
                  <div className="grid items-center gap-1" style={{ gridTemplateColumns: GRID_COLUMNS }}>
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{
                        backgroundColor: running
                          ? "var(--ant-color-success)"
                          : "var(--ant-color-text-quaternary)",
                      }}
                    />
                    <span
                      className="text-[10px] leading-[14px] rounded font-medium cursor-pointer flex items-center justify-center"
                      style={{
                        width: 40,
                        backgroundColor:
                          DEV_KIND_COLORS[service.kind] ?? DEV_KIND_COLORS.command,
                        color: "#fff",
                      }}
                      title={`${devKindShort(service.kind)} 服务，双击改名`}
                      onDoubleClick={() => openRename(service)}
                    >
                      {devKindShort(service.kind)}
                    </span>
                    <span
                      className="text-xs cursor-pointer truncate min-w-0"
                      style={{ color: "var(--ant-color-text)" }}
                      onClick={() => setExpandedId(expanded ? null : service.id)}
                      title={service.command}
                    >
                      {service.name}
                    </span>
                    <span
                      className="text-xs text-[var(--ant-color-text-quaternary)] truncate min-w-0"
                      title={allProjects ? projectName(service.projectId) : undefined}
                    >
                      {allProjects ? projectName(service.projectId) : ""}
                    </span>
                    <span className="flex items-center justify-end gap-1.5 overflow-hidden whitespace-nowrap min-w-0">
                      {(states[service.id]?.ports ?? []).map((port) => {
                        const url = `http://127.0.0.1:${port}`;
                        return (
                          <a
                            key={port}
                            href={url}
                            className="text-xs flex-shrink-0"
                            style={{
                              color: "var(--ant-color-link)",
                              textDecoration: "underline",
                              cursor: "pointer",
                            }}
                            title={`在浏览器打开 ${url}`}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              void openExternal(url);
                            }}
                          >
                            :{port}
                          </a>
                        );
                      })}
                    </span>
                    <span />
                    <Button
                      size="small"
                      type="text"
                      style={ICON_BUTTON_STYLE}
                      icon={running ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
                      onClick={() => (running ? handleStop(service) : handleStart(service))}
                    />
                    <Button
                      size="small"
                      type="text"
                      danger
                      style={ICON_BUTTON_STYLE}
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

      <Modal
        title="删除服务"
        open={!!deleteTarget}
        onOk={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
        okText="删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        width={360}
        destroyOnHidden
        mask={{ closable: false }}
      >
        <div className="text-sm text-[var(--ant-color-text-secondary)]">
          确定要删除服务「{deleteTarget?.name}」吗？删除后无法恢复。
        </div>
      </Modal>

      <Modal
        title="修改服务名称"
        open={!!renameTarget}
        onOk={handleRename}
        onCancel={() => setRenameTarget(null)}
        okText="保存"
        cancelText="取消"
        width={360}
        destroyOnHidden
        mask={{ closable: false }}
      >
        <Input
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onPressEnter={handleRename}
          placeholder="服务名称"
          autoFocus
        />
      </Modal>
    </>
  );
}
