import { invoke } from "@tauri-apps/api/core";
import type {
  CliTool,
  DirEntry,
  Profile,
  SessionCost,
  CostSummary,
  PricingConfig,
  ToolSettings,
  Project,
  Session,
  SessionCategory,
  LlmProvider,
  CreateLlmProviderInput,
  UpdateLlmProviderInput,
  PresetProviderView,
  TranscriptEntry,
  SshTarget,
  TransferSummary,
} from "../types";

export async function detectCliTools(): Promise<CliTool[]> {
  return invoke<CliTool[]>("detect_cli_tools");
}

export async function startSession(params: {
  toolType: string;
  profileId: string;
  workDir: string;
  tabId: string;
  envVars?: Record<string, string>;
  cliArgs?: string;
  cliSessionId?: string;
  llmProviderId?: string;
  modelName?: string;
  claudeModels?: string;
}): Promise<void> {
  return invoke("start_session", params);
}

export async function stopSession(tabId: string): Promise<void> {
  return invoke("stop_session", { tabId });
}

export async function writeToPty(tabId: string, data: string): Promise<void> {
  return invoke("write_to_pty", { tabId, data });
}

export async function resizePty(
  tabId: string,
  cols: number,
  rows: number,
): Promise<void> {
  return invoke("resize_pty", { tabId, cols, rows });
}

export async function testSshConnection(params: {
  hostname: string;
  port?: number;
  username?: string;
  password?: string;
  identity_file?: string;
}): Promise<string> {
  return invoke("test_ssh_connection", { params });
}

/**
 * 把若干本地文件上传到远程目录。传输期间进度走 `ssh_transfer:progress` 事件。
 *
 * `requestId` 由前端生成，原样出现在进度事件里 —— 并发传输时靠它把进度
 * 对上日志表里的行。
 */
export async function sshUpload(params: {
  target: SshTarget;
  tabId: string;
  localPaths: string[];
  remotePath: string;
  requestId: string;
}): Promise<TransferSummary> {
  return invoke("ssh_upload", { request: params });
}

/** 把单个远程文件下载到本地目录。重名时后端自动加序号。 */
export async function sshDownload(params: {
  target: SshTarget;
  tabId: string;
  remotePath: string;
  localDir: string;
  requestId: string;
}): Promise<TransferSummary> {
  return invoke("ssh_download", { request: params });
}

/**
 * 列出远程目录。
 *
 * 连接参数由后端按 `target` 解析 —— 前端碰不到密码。
 */
export async function sshListDir(
  target: SshTarget,
  path: string,
): Promise<DirEntry[]> {
  return invoke("ssh_list_dir", { target, path });
}

/** 列出本地目录。前端拿不到文件系统，只能由后端读。 */
export async function fsListDir(path: string): Promise<DirEntry[]> {
  return invoke("fs_list_dir", { path });
}

/** 请求取消进行中的传输。返回 false 表示该任务已结束或 id 未知。 */
export async function sshTransferCancel(transferId: string): Promise<boolean> {
  return invoke("ssh_transfer_cancel", { transferId });
}

/**
 * 探测 SSH 会话远程的当前目录。仅 SSH 工具会话有意义 ——
 * Terminal 会话的 PTY 是本地 shell，返回的会是本地路径，故不在其上调用。
 *
 * 后端走一条独立的短连接执行 `pwd`，不碰用户的终端（往交互式 PTY 里敲探测
 * 命令会把命令和输出留在终端里）。拿到的是远端账号的登录目录，不是交互会话
 * 里 `cd` 之后的目录。失败或超时时抛错，调用方应回落 `~/`。
 */
export async function sshProbeRemoteCwd(tabId: string): Promise<string> {
  return invoke("ssh_probe_remote_cwd", { tabId });
}

export async function listProfiles(toolType?: string): Promise<Profile[]> {
  return invoke<Profile[]>("list_profiles", { toolType });
}

export async function createProfile(
  profile: Omit<Profile, "id" | "createdAt" | "updatedAt">,
): Promise<Profile> {
  return invoke<Profile>("create_profile", { profile });
}

export async function updateProfile(
  id: string,
  updates: Partial<Profile>,
): Promise<Profile> {
  return invoke<Profile>("update_profile", { id, updates });
}

export async function deleteProfile(
  id: string,
  options: { removeData: boolean },
): Promise<void> {
  return invoke("delete_profile", { id, options });
}

export async function getSessionCost(sessionId: string): Promise<SessionCost> {
  return invoke<SessionCost>("get_session_cost", { sessionId });
}

export async function getProfileCost(
  profileId: string,
  range?: { from: number; to: number },
): Promise<CostSummary> {
  return invoke<CostSummary>("get_profile_cost", { profileId, range });
}

export async function getGlobalCost(
  range?: { from: number; to: number },
): Promise<CostSummary> {
  return invoke<CostSummary>("get_global_cost", { range });
}

export async function listPricing(): Promise<PricingConfig[]> {
  return invoke<PricingConfig[]>("list_pricing");
}

export async function updatePricing(
  model: string,
  config: Partial<PricingConfig>,
): Promise<void> {
  return invoke("update_pricing", { model, config });
}

export async function scanCosts(profileId?: string): Promise<number> {
  return invoke<number>("scan_costs", { profileId });
}

export async function getProfileCredential(
  profileId: string,
  keyName: string,
): Promise<string | null> {
  return invoke<string | null>("get_profile_credential", { profileId, keyName });
}

export async function storeProfileCredential(
  profileId: string,
  keyName: string,
  value: string,
): Promise<void> {
  return invoke("store_profile_credential", { profileId, keyName, value });
}

export async function pollCosts(): Promise<number> {
  return invoke<number>("poll_costs");
}

// Tool Settings IPC
export async function getToolSettings(profileId: string): Promise<ToolSettings | null> {
  return invoke<ToolSettings | null>("get_tool_settings", { profileId });
}

export async function upsertToolSettings(input: Omit<ToolSettings, "id" | "createdAt" | "updatedAt">): Promise<ToolSettings> {
  return invoke<ToolSettings>("upsert_tool_settings", { input });
}

export async function deleteToolSettings(profileId: string): Promise<void> {
  return invoke("delete_tool_settings", { profileId });
}

// Project IPC
export async function projectList(): Promise<Project[]> {
  return invoke<Project[]>("project_list");
}

export async function projectCreate(input: {
  name: string;
  path: string;
  color?: string;
}): Promise<Project> {
  return invoke<Project>("project_create", { input });
}

export async function projectUpdate(
  id: string,
  input: { name?: string; color?: string },
): Promise<Project> {
  return invoke<Project>("project_update", { id, input });
}

export async function projectDelete(id: string): Promise<void> {
  return invoke("project_delete", { id });
}

/** 按给定顺序重写项目排序号（从 0 连续编号） */
export async function projectReorder(ids: string[]): Promise<void> {
  return invoke("project_reorder", { ids });
}

// Session IPC
export async function sessionList(projectId?: string): Promise<Session[]> {
  return invoke<Session[]>("session_list", { projectId });
}

export async function sessionCreate(input: {
  projectId: string;
  toolType: string;
  title?: string;
  profileId?: string;
  color?: string;
  thinkingIntensity?: string;
  templateId?: string;
  cliArgs?: string;
  envVars?: string;
  cliSessionId?: string;
  categoryId?: string;
  llmProviderId?: string;
  modelName?: string;
  claudeModels?: string;
}): Promise<Session> {
  return invoke<Session>("session_create", { input });
}

export async function sessionUpdate(
  id: string,
  input: {
    title?: string;
    profileId?: string;
    color?: string;
    thinkingIntensity?: string;
    templateId?: string;
    cliArgs?: string;
    envVars?: string;
    isRunning?: boolean;
    closedAt?: number;
    projectId?: string;
    cliSessionId?: string;
    categoryId?: string;
    llmProviderId?: string;
    modelName?: string;
    claudeModels?: string;
  },
): Promise<Session> {
  return invoke<Session>("session_update", { id, input });
}

export async function sessionDelete(id: string): Promise<void> {
  return invoke("session_delete", { id });
}

/**
 * 一条会话的重排指令：改归属 + 定序号。
 * projectId 不传表示留在原项目；categoryId 为 undefined 表示移到项目根目录（未分类）。
 */
export interface SessionMove {
  id: string;
  projectId?: string | null;
  categoryId?: string | null;
  sortOrder: number;
}

/**
 * 批量重排会话。调用方需把受影响的分组（拖动时的源组与目标组）**完整**传进来，
 * 每组从 0 连续编号 —— 否则会出现重复的 sortOrder，展示顺序取决于数据库的返回顺序。
 */
export async function sessionReorder(moves: SessionMove[]): Promise<void> {
  return invoke("session_reorder", { moves });
}

export async function claudeJsonlExists(
  cliSessionId: string,
  workDir: string,
  claudeConfigDir: string | null,
): Promise<boolean> {
  return invoke<boolean>("claude_jsonl_exists", {
    cliSessionId,
    workDir,
    claudeConfigDir,
  });
}

export async function claudeTranscriptRead(
  cliSessionId: string,
  workDir: string,
  claudeConfigDir: string | null,
  limit?: number,
): Promise<TranscriptEntry[] | null> {
  return invoke<TranscriptEntry[] | null>("claude_transcript_read", {
    cliSessionId,
    workDir,
    claudeConfigDir,
    limit,
  });
}

// Category IPC
export async function categoryList(projectId?: string): Promise<SessionCategory[]> {
  return invoke<SessionCategory[]>("category_list", { projectId });
}

export async function categoryCreate(input: {
  projectId: string;
  name: string;
  color?: string;
  sortOrder?: number;
}): Promise<SessionCategory> {
  return invoke<SessionCategory>("category_create", { input });
}

export async function categoryUpdate(
  id: string,
  input: {
    name?: string;
    color?: string;
    sortOrder?: number;
  },
): Promise<SessionCategory> {
  return invoke<SessionCategory>("category_update", { id, input });
}

export async function categoryDelete(id: string): Promise<void> {
  return invoke("category_delete", { id });
}

/** 按给定顺序重写分类排序号（从 0 连续编号） */
export async function categoryReorder(ids: string[]): Promise<void> {
  return invoke("category_reorder", { ids });
}

// Session Message IPC
export interface SessionMessage {
  id: string;
  sessionId: string;
  content: string;
  lineIndex: number;
  createdAt: number;
  isSensitive: boolean;
}

export async function sessionMessageList(sessionId: string): Promise<SessionMessage[]> {
  return invoke<SessionMessage[]>("session_message_list", { sessionId });
}

export async function sessionMessageCreate(input: {
  sessionId: string;
  content: string;
  lineIndex: number;
}): Promise<SessionMessage> {
  return invoke<SessionMessage>("session_message_create", { input });
}

export async function sessionMessageDelete(sessionId: string): Promise<void> {
  return invoke("session_message_delete", { sessionId });
}

/**
 * 标记/取消标记一条消息的敏感属性。标记后内容仍存 DB(配合真擦除路径使用),
 * 前端按 isSensitive 决定是否脱敏渲染。
 */
export async function sessionMessageMarkSensitive(
  id: string,
  isSensitive: boolean,
): Promise<void> {
  return invoke("session_message_mark_sensitive", { id, isSensitive });
}

/** 单条真擦除：DB 行彻底删除。 */
export async function sessionMessageDeleteOne(id: string): Promise<void> {
  return invoke("session_message_delete_one", { id });
}

/** 当前 session 下批量擦除所有已标记敏感的消息，返回受影响行数。 */
export async function sessionMessageDeleteSensitive(
  sessionId: string,
): Promise<number> {
  return invoke<number>("session_message_delete_sensitive", { sessionId });
}

// System IPC
export async function isAutostartEnabled(): Promise<boolean> {
  return invoke<boolean>("is_autostart_enabled");
}

export async function setAutostartEnabled(enabled: boolean): Promise<void> {
  return invoke("set_autostart_enabled", { enabled });
}

export async function getCloseBehavior(): Promise<string> {
  return invoke<string>("get_close_behavior");
}

export async function setCloseBehavior(behavior: string): Promise<void> {
  return invoke("set_close_behavior", { behavior });
}

export async function setTrayVisible(visible: boolean): Promise<void> {
  return invoke("set_tray_visible", { visible });
}

export async function openPathInFileManager(path: string): Promise<void> {
  return invoke("open_path_in_file_manager", { path });
}

export async function openTerminal(path: string): Promise<void> {
  return invoke("open_terminal", { path });
}

export async function listSystemFonts(): Promise<string[]> {
  return invoke<string[]>("list_system_fonts");
}

/**
 * 通过 tauri-plugin-clipboard-manager 读/写剪贴板。
 *
 * 为什么不用 navigator.clipboard：Tauri 2 + WebKitGTK (Linux) 下 webview 默认
 * 不授予 navigator.clipboard 读写权限，会抛 NotAllowedError。这里走 Rust 插件
 * 直接读 X11/Wayland 剪贴板，绕过 webview 沙箱限制。
 */
export async function readClipboardText(): Promise<string> {
  return invoke<string>("plugin:clipboard-manager|read_text");
}

export async function writeClipboardText(text: string): Promise<void> {
  return invoke("plugin:clipboard-manager|write_text", { label: null, text });
}

// LLM Provider IPC

export async function listLlmProviders(includeInactive = false): Promise<LlmProvider[]> {
  return await invoke<LlmProvider[]>("llm_provider_list", { includeInactive });
}

export async function getLlmProvider(id: string): Promise<LlmProvider | null> {
  return await invoke<LlmProvider | null>("llm_provider_get", { id });
}

export async function createLlmProvider(input: CreateLlmProviderInput): Promise<LlmProvider> {
  return await invoke<LlmProvider>("llm_provider_create", { input });
}

export async function updateLlmProvider(
  id: string,
  input: UpdateLlmProviderInput,
): Promise<LlmProvider> {
  return await invoke<LlmProvider>("llm_provider_update", { id, input });
}

export async function deleteLlmProvider(id: string): Promise<void> {
  await invoke("llm_provider_delete", { id });
}

export async function hardDeleteLlmProvider(id: string): Promise<void> {
  await invoke("llm_provider_hard_delete", { id });
}

export async function setLlmProviderDefaultModel(
  providerId: string,
  modelId: string,
): Promise<void> {
  await invoke("llm_provider_set_default_model", { providerId, modelId });
}

export async function listLlmProviderPresets(): Promise<PresetProviderView[]> {
  return await invoke<PresetProviderView[]>("llm_provider_list_presets");
}

export async function setDefaultLlmProvider(providerId: string): Promise<void> {
  await invoke("llm_provider_set_default_provider", { providerId });
}

export async function hasLlmProviderApiKey(providerId: string): Promise<boolean> {
  return invoke<boolean>("llm_provider_has_api_key", { providerId });
}

export async function getLlmProviderApiKey(providerId: string): Promise<string | null> {
  return invoke<string | null>("llm_provider_get_api_key", { providerId });
}
