import { memo, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { openUrl } from "@tauri-apps/plugin-opener";
import { message } from "antd";
import { rehypeHighlight } from "./markdownHighlight";

/** 插件数组必须是模块级常量:react-markdown 按数组引用判断是否重跑
 *  unified 流水线,每次渲染传新字面量会把整棵 markdown 树重新解析+消毒。 */
const REMARK_PLUGINS = [remarkGfm];

/** 从组件自身反推 rehypePlugins 的类型 —— unified 的 Pluggable 元组类型
 *  推不出来(嵌套数组会被当成联合数组),为此单独引 unified 只为拿类型不划算。 */
type RehypePlugins = NonNullable<
  React.ComponentProps<typeof ReactMarkdown>["rehypePlugins"]
>;

/**
 * 打开链接。
 *
 * 只放行 http/https —— 正文是 AI 生成的文本,不能让它诱导 opener 打开
 * file:// 之类的本地协议或执行任意 scheme。
 */
async function openExternal(href: string | undefined): Promise<void> {
  if (!href) return;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    message.warning("链接格式无效，已跳过");
    return;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    message.warning("已阻止打开非 http(s) 链接");
    return;
  }
  try {
    await openUrl(url.toString());
  } catch {
    message.warning("无法在系统浏览器中打开该链接");
  }
}

/**
 * 面板正文渲染。
 *
 * 尺寸/间距全部交给 index.css 的 `.md-body` 规则,这里只接管需要 JS 判断或
 * 需要额外包裹容器的节点。
 */
const MARKDOWN_COMPONENTS: Components = {
  // 桌面 webview 里 window.open 会被静默拦截(返回 null 且不报错),
  // 必须走 Tauri opener 在系统浏览器打开。
  a: ({ href, children }) => (
    <a
      href={href}
      title={href}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void openExternal(href);
      }}
    >
      {children}
    </a>
  ),
  // 图片一律降级为文字说明:正文里的外链图片会发起远程请求,
  // 既拖慢面板,也在本地优先的产品里泄漏用户会话内容。
  img: ({ alt }) => <em>{alt ? `[图片：${alt}]` : "[图片]"}</em>,
  // 横向滚动必须由 table 外的独立容器承担。给 table 本身加 overflow-x 不管用:
  // 它是 display:table,内部会生成匿名表格并被压缩到容器宽度,永远不会溢出。
  // 注意要把 <table> 显式渲染出来再把 children 放进去 —— 直接透传 children
  // 会让 <thead>/<tbody> 落到 div 下,那是非法 HTML。
  table: ({ children, node, ...props }) => (
    <div className="md-table-wrap">
      <table {...props}>{children}</table>
    </div>
  ),
};

interface MarkdownBodyProps {
  text: string;
  /** 超过该行数就截断;不传则完整展开 */
  clampLines?: number;
  /**
   * 搜索关键词。非空时命中文字会包成 <mark>。
   * 调用方必须用 useMemo 保住引用，否则每次渲染都会重跑整条流水线。
   */
  tokens: readonly string[];
}

/**
 * 一条提问/回应的正文。
 *
 * memo:面板每 8 秒全量重拉一次,内容比对虽已保证无变化时保留旧引用,
 * 但仍会把 props 传进来 —— memo 让文本未变的条目跳过整棵树的重建。
 */
export const MarkdownBody = memo(function MarkdownBody({
  text,
  clampLines,
  tokens,
}: MarkdownBodyProps) {
  // 高亮插件要闭包住 tokens，只能在这里现造 —— 但数组引用只在 tokens 变化时
  // 才变，等于"关键词变了才重跑流水线"，正是需要的粒度。
  const rehypePlugins = useMemo(
    () =>
      [rehypeSanitize, [rehypeHighlight, { tokens: tokens as string[] }]] as unknown as RehypePlugins,
    [tokens],
  );

  return (
    <div
      className="md-body"
      style={
        clampLines
          ? {
              display: "-webkit-box",
              WebkitLineClamp: clampLines,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }
          : undefined
      }
    >
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={rehypePlugins}
        components={MARKDOWN_COMPONENTS}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});