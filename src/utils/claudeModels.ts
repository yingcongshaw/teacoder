// Claude Code 模型映射的序列化/规范化工具
// 后端存储为 JSON 字符串（Option<String>），前端业务层始终操作对象

export interface ClaudeModels {
  sonnet?: string;
  opus?: string;
  haiku?: string;
  fable?: string;
  subagent?: string;
  sonnet1M?: boolean;
  opus1M?: boolean;
  haiku1M?: boolean;
  fable1M?: boolean;
  subagent1M?: boolean;
}

const CLAUDE_MODEL_KEYS = ["sonnet", "opus", "haiku", "fable", "subagent"] as const;
const CLAUDE_ONE_M_KEYS = ["sonnet1M", "opus1M", "haiku1M", "fable1M", "subagent1M"] as const;

/**
 * 将任意形态的输入（字符串、对象、污染数据、null/undefined）规范化为 ClaudeModels 对象。
 * 永远不会抛错；解析失败回退到空对象。
 *
 * 历史问题：DB 中已存在被二次/三次 JSON.stringify 污染的数据；
 * 白名单字段提取能自动忽略污染产生的数字索引键。
 */
export function parseClaudeModels(raw: unknown): ClaudeModels {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== "string" && typeof raw !== "object") return {};
  if (typeof raw === "string" && raw.trim() === "") return {};

  let value: unknown = raw;

  // 字符串形态 → 反复剥 JSON 字符串编码（处理双重 / 多次 stringify）
  while (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return {};
    try {
      value = JSON.parse(trimmed);
    } catch {
      return {};
    }
    if (typeof value === "string") continue;
    break;
  }

  // 非对象形态（数字、布尔、数组等）→ 空对象
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  // 白名单字段提取（5 个模型字段 + 5 个 1M 标记字段）
  const result: ClaudeModels = {};
  const obj = value as Record<string, unknown>;
  for (const key of CLAUDE_MODEL_KEYS) {
    const v = obj[key];
    if (typeof v === "string" && v.length > 0) {
      result[key] = v;
    }
  }
  for (const key of CLAUDE_ONE_M_KEYS) {
    if (obj[key] === true) {
      result[key] = true;
    }
  }
  return result;
}

/**
 * 是否有有效字段（任一 tier 模型名非空）。
 * 1M 标记不影响"是否要持久化"的判定。
 */
export function hasMeaningfulClaudeModels(value: ClaudeModels | undefined | null): boolean {
  if (!value) return false;
  for (const key of CLAUDE_MODEL_KEYS) {
    const v = value[key];
    if (typeof v === "string" && v.length > 0) return true;
  }
  return false;
}

/**
 * 序列化为可发送到后端的 JSON 字符串。
 * 当没有有效字段时返回 undefined，由 Rust 端写入 NULL。
 * 1M=false 不写入（节省存储 & 减少 JSON.stringify 噪音）。
 */
export function serializeClaudeModels(value: ClaudeModels | undefined | null): string | undefined {
  if (!hasMeaningfulClaudeModels(value)) return undefined;
  const source = value!;
  const clean: ClaudeModels = {};
  for (const key of CLAUDE_MODEL_KEYS) {
    const v = source[key];
    if (typeof v === "string" && v.length > 0) clean[key] = v;
  }
  for (const key of CLAUDE_ONE_M_KEYS) {
    if (source[key] === true) clean[key] = true;
  }
  return JSON.stringify(clean);
}

/**
 * 一键获取 tier key 与 1M 标记 key 的元组。
 * 渲染下拉框 + Checkbox 时使用，避免硬编码字符串。
 */
export const CLAUDE_TIER_ENTRIES: ReadonlyArray<{
  modelKey: (typeof CLAUDE_MODEL_KEYS)[number];
  oneMKey: (typeof CLAUDE_ONE_M_KEYS)[number];
  label: string;
}> = [
  { modelKey: "sonnet", oneMKey: "sonnet1M", label: "Sonnet" },
  { modelKey: "opus", oneMKey: "opus1M", label: "Opus" },
  { modelKey: "haiku", oneMKey: "haiku1M", label: "Haiku" },
  { modelKey: "fable", oneMKey: "fable1M", label: "Fable" },
  { modelKey: "subagent", oneMKey: "subagent1M", label: "Subagent" },
];
