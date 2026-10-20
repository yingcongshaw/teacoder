// Mock for @tauri-apps/api/event — only used in browser test harness
export async function listen<T = unknown>(_event: string, _handler: (event: { payload: T }) => void): Promise<() => void> {
  return () => {};
}

export async function emit(_event: string, _payload?: unknown): Promise<void> {
  return;
}

export async function once<T = unknown>(_event: string, _handler: (event: { payload: T }) => void): Promise<() => void> {
  return () => {};
}