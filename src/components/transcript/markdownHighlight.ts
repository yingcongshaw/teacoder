/**
 * 搜索词高亮（rehype 插件）。
 *
 * 在 hast 树上做，而不是在 React 层做：markdown 渲染后的命中文字可能落在
 * <p>/<li>/<td>/<code> 等任意元素的文本节点里，只有遍历 AST 才能一次覆盖，
 * 且不会破坏 markdown 结构。放在 sanitize 之后执行 —— sanitize 依据标签白名单
 * 放行 <mark>，先高亮再消毒会被剥掉。
 */
export interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

function markNode(text: string): HastNode {
  return {
    type: "element",
    tagName: "mark",
    properties: {},
    children: [{ type: "text", value: text }],
  };
}

/**
 * 按多个关键词切分文本，命中段落换成 <mark>。
 * 关键词之间取「任一命中」：搜「tenant 门控」时两处都标出来，
 * 否则中文正文里因插入了其他字导致的短语不连续会让搜索看起来失效。
 */
function splitByTokens(text: string, tokens: string[]): HastNode[] {
  const spans: { start: number; end: number }[] = [];
  for (const token of tokens) {
    if (!token) continue;
    let from = 0;
    for (;;) {
      const at = text.indexOf(token, from);
      if (at < 0) break;
      const end = at + token.length;
      // 已被更长关键词占用的区间不再重复标记
      if (!spans.some((s) => at < s.end && end > s.start)) {
        spans.push({ start: at, end });
      }
      from = at + 1;
    }
  }
  if (spans.length === 0) return [{ type: "text", value: text }];

  spans.sort((a, b) => a.start - b.start);
  const out: HastNode[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) out.push({ type: "text", value: text.slice(cursor, span.start) });
    out.push(markNode(text.slice(span.start, span.end)));
    cursor = span.end;
  }
  if (cursor < text.length) out.push({ type: "text", value: text.slice(cursor) });
  return out;
}

function highlightChildren(node: HastNode, tokens: string[]): void {
  const children = node.children;
  if (!children) return;
  const next: HastNode[] = [];
  for (const child of children) {
    if (child.type === "text" && typeof child.value === "string") {
      next.push(...splitByTokens(child.value, tokens));
    } else {
      highlightChildren(child, tokens);
      next.push(child);
    }
  }
  node.children = next;
}

export function rehypeHighlight(options: { tokens: string[] }): (tree: HastNode) => void {
  return (tree) => {
    if (options.tokens.length === 0) return;
    highlightChildren(tree, options.tokens);
  };
}

/** 搜索框输入 → 高亮关键词。空白分词，空串产生空数组表示「不高亮」。 */
export function tokenizeQuery(query: string): string[] {
  return query.split(/\s+/).filter(Boolean);
}