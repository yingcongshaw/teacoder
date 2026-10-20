// Mock for @tauri-apps/api/core — only used in browser test harness
export async function invoke<T = unknown>(_cmd: string, _args?: Record<string, unknown>): Promise<T | null> {
  return null;
}