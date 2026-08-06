import { invoke } from "@tauri-apps/api/core";
import type { CliTool, Profile, SessionCost, CostSummary, PricingConfig, ToolSettings, Project, Session } from "../types";

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
  },
): Promise<Session> {
  return invoke<Session>("session_update", { id, input });
}

export async function sessionDelete(id: string): Promise<void> {
  return invoke("session_delete", { id });
}
