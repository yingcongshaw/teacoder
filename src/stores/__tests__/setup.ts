// Node 26 内置了 localStorage，但未提供 --localstorage-file 时它是 undefined，
// 会遮蔽测试环境（happy-dom/jsdom）提供的实现。这里显式注入内存版实现。
const memory = new Map<string, string>();

const localStorageImpl = {
  getItem: (key: string) => (memory.has(key) ? memory.get(key)! : null),
  setItem: (key: string, value: string) => void memory.set(key, String(value)),
  removeItem: (key: string) => void memory.delete(key),
  clear: () => memory.clear(),
  key: (index: number) => Array.from(memory.keys())[index] ?? null,
  get length() {
    return memory.size;
  },
};

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageImpl,
  configurable: true,
  writable: true,
});
