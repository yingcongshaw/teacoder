/**
 * 帮助窗口的标题锚点与目录。
 *
 * 目录直接读渲染结果，不再从 README 原文另推一遍标题 ——
 * 两份推导只要有一处对不上，目录就会跳错地方。
 */

/** hast 节点的结构化子集：插件只用到类型、标签名、属性和子节点 */
interface DocNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: DocNode[];
}

/** 目录条目 */
export interface OutlineItem {
  /** 标题层级 */
  depth: number;
  /** 标题纯文本 */
  text: string;
  /** 锚点 id */
  id: string;
}

/** 目录分组：二级标题带着它的三级子项 */
export interface OutlineGroup {
  item: OutlineItem;
  children: OutlineItem[];
}

/**
 * 生成锚点 id：小写、空白转连字符、去掉标点。
 *
 * 汉字属于 \p{L}，会原样保留。
 */
function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

/** 同名标题要加序号区分，和 GitHub 的锚点行为一致 */
function uniqueSlug(text: string, used: Map<string, number>): string {
  const base = slugify(text);
  const seen = used.get(base) ?? 0;
  used.set(base, seen + 1);
  return seen === 0 ? base : `${base}-${seen}`;
}

/** 收集节点的纯文本 */
function nodeText(node: DocNode): string {
  if (node.type === "text") return node.value ?? "";
  if (!node.children) return "";
  return node.children.map(nodeText).join("");
}

/**
 * 给标题补 id，供目录跳转。
 *
 * 消毒时还会给 id 加上防篡改前缀，目录用的是渲染后的真实 id，两边自然对得上。
 */
export function rehypeHeadingIds() {
  return (tree: DocNode) => {
    const used = new Map<string, number>();
    const walk = (node: DocNode) => {
      if (node.type === "element" && /^h[1-6]$/.test(node.tagName ?? "")) {
        const id = uniqueSlug(nodeText(node), used);
        node.properties = { ...node.properties, id };
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}

/**
 * 把目录条目按二级标题分组。
 *
 * 分组是为了排版：分栏时整组不拆开，父标题不会和它的子项分到两栏。
 */
export function groupOutline(items: OutlineItem[]): OutlineGroup[] {
  const groups: OutlineGroup[] = [];
  for (const item of items) {
    if (item.depth === 2 || groups.length === 0) {
      groups.push({ item, children: [] });
    } else {
      groups[groups.length - 1].children.push(item);
    }
  }
  return groups;
}
