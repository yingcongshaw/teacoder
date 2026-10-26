import { useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { Button, Modal, Tooltip } from "antd";
import { MenuFoldOutlined, UnorderedListOutlined } from "@ant-design/icons";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import readmeRaw from "../../../README.md?raw";
import helpImageDims from "virtual:help-image-dims";
import { openExternal, openMailto } from "../../utils/openExternal";
import { groupOutline, rehypeHeadingIds, type OutlineItem } from "./docOutline";

const REPO_URL = "https://github.com/yingcongshaw/teacoder";

/** 从组件自身反推 rehypePlugins 的类型 —— unified 的 Pluggable 元组类型
 *  推不出来(嵌套数组会被当成联合数组),为此单独引 unified 只为拿类型不划算。 */
type RehypePlugins = NonNullable<
  ComponentProps<typeof ReactMarkdown>["rehypePlugins"]
>;

/** 插件数组必须是模块级常量:react-markdown 按数组引用判断是否重跑
 *  unified 流水线,每次渲染传新字面量会把整棵 markdown 树重新解析+消毒。 */
const REMARK_PLUGINS = [remarkGfm];

/** 默认 schema 不放行 img 的 loading/decoding,截图的懒加载属性会被剥掉 */
const SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    img: [...(defaultSchema.attributes?.img ?? []), "loading", "decoding"],
  },
};

const REHYPE_PLUGINS: RehypePlugins = [
  rehypeRaw,
  rehypeHeadingIds,
  [rehypeSanitize, { schema: SANITIZE_SCHEMA }],
];

/**
 * 把 README 里的仓库内相对链接改写成 GitHub 绝对地址。
 *
 * README 原本是给 GitHub 仓库页面读的,./LICENSE、../../releases 这类相对路径
 * 在应用内没有对应路由,必须落到仓库地址上才能点得开。
 */
function resolveDocLink(href: string): string {
  if (href.startsWith("./")) {
    return `${REPO_URL}/blob/main/${href.slice(2)}`;
  }
  if (href.startsWith("../../")) {
    return `${REPO_URL}/${href.slice(6)}`;
  }
  return href;
}

/**
 * 把 README 里的图片路径改写成应用内可访问的路径。
 *
 * README 引用的是仓库里的 public/xxx(写法上 ./public 与 public 两种都有),
 * 而 public 会被打包到站点根,所以要剥掉这层前缀。
 */
function resolveDocImage(src: string): string {
  const path = src.startsWith("./") ? src.slice(2) : src;
  return path.startsWith("public/") ? `/${path.slice(7)}` : path;
}

/**
 * 决定图片的显示尺寸。
 *
 * 尺寸先由 README 自己给(logo 就是靠 width="96" 定尺寸的),只给了一边时
 * 按原图比例补齐另一边,两边都缺时用原图尺寸。浏览器据此预留位置,
 * 懒加载时才不会把文档一路撑高、把弹窗拽到中段。
 */
function resolveDisplaySize(
  width: string | number | undefined,
  height: string | number | undefined,
  intrinsic: [number, number] | undefined,
): { width?: string | number; height?: string | number } {
  if (width && height) return { width, height };
  if (width && intrinsic) {
    const w = Number(width);
    return Number.isFinite(w)
      ? { width, height: Math.round((w * intrinsic[1]) / intrinsic[0]) }
      : { width };
  }
  if (height && intrinsic) {
    const h = Number(height);
    return Number.isFinite(h)
      ? { width: Math.round((h * intrinsic[0]) / intrinsic[1]), height }
      : { height };
  }
  if (intrinsic) return { width: intrinsic[0], height: intrinsic[1] };
  return { width, height };
}

const MARKDOWN_COMPONENTS: Components = {
  // 桌面 webview 里 window.open 会被静默拦截(返回 null 且不报错),
  // 必须走 Tauri opener 在系统浏览器打开。
  a: ({ href, children }) => {
    const target = resolveDocLink(href ?? "");
    return (
      <a
        href={target}
        title={target}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (target.startsWith("mailto:")) {
            void openMailto(target);
            return;
          }
          void openExternal(target);
        }}
      >
        {children}
      </a>
    );
  },
  // README 的截图动辄几 MB,懒加载避免打开弹窗就拉全量。
  // width/height 要原样带过去 —— README 的 logo 就是靠 width="96" 定尺寸的。
  img: ({ src, alt, title, width, height, node, ...props }) => {
    const resolved = src ? resolveDocImage(src) : undefined;
    const intrinsic = resolved ? helpImageDims[resolved] : undefined;
    const size = resolveDisplaySize(width, height, intrinsic);
    return (
      <img
        {...props}
        src={resolved}
        alt={alt ?? ""}
        title={title}
        width={size.width}
        height={size.height}
        loading="lazy"
        decoding="async"
      />
    );
  },
  // 横向滚动必须由 table 外的独立容器承担,详见 MarkdownBody 的同名处理。
  table: ({ children, node, ...props }) => (
    <div className="md-table-wrap">
      <table {...props}>{children}</table>
    </div>
  ),
};

interface HelpModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * 弹窗正文:README 渲染结果 + 右侧目录。
 *
 * 目录和正文必须放在同一个组件里 —— AntD 的 Modal 是把内容挂到 Portal 上的,
 * 正文那棵子树要晚于 open 翻真才进 DOM。父组件的 effect 跑的时候正文还没到,
 * 只有跟正文一起挂载的这个组件才扫得到标题。
 */
function HelpContent() {
  const contentRef = useRef<HTMLDivElement>(null);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [tocOpen, setTocOpen] = useState(false);

  // 目录直接读渲染出来的标题,id 和文字都用渲染后的真实值,
  // 免得再从 README 原文推一遍 —— 推错一个字目录就跳不过去。
  // 用 layout effect 是为了赶在浏览器绘制前建好,目录跟正文同帧出现。
  // 依赖 README 原文:开发时改了 README 会热更新,标题跟着变,目录要重扫。
  useLayoutEffect(() => {
    const headings = contentRef.current?.querySelectorAll<HTMLElement>("h2, h3");
    if (!headings) {
      setOutline([]);
      return;
    }
    setOutline(
      [...headings].map((h) => ({
        depth: h.tagName === "H3" ? 3 : 2,
        text: h.textContent ?? "",
        id: h.id,
      })),
    );
  }, [readmeRaw]);

  const scrollToHeading = (id: string) => {
    const target = document.getElementById(id);
    // 只认弹窗内的锚点,免得跟应用别处的 id 撞车
    if (!target || !contentRef.current?.contains(target)) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="help-layout">
      <div className="help-main">
        <div ref={contentRef} className="md-body help-body">
          <ReactMarkdown
            remarkPlugins={REMARK_PLUGINS}
            rehypePlugins={REHYPE_PLUGINS}
            components={MARKDOWN_COMPONENTS}
          >
            {readmeRaw}
          </ReactMarkdown>
        </div>
      </div>

      {tocOpen && outline.length > 0 && (
        <nav className="help-toc">
          <div className="help-toc-title">目录</div>
          <div>
            {groupOutline(outline).map((group) => (
              <div key={group.item.id} className="help-toc-group">
                <div className="help-toc-item">
                  <a
                    href={`#${group.item.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      scrollToHeading(group.item.id);
                    }}
                  >
                    {group.item.text}
                  </a>
                </div>
                {group.children.map((child) => (
                  <div key={child.id} className="help-toc-item help-toc-sub">
                    <a
                      href={`#${child.id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        scrollToHeading(child.id);
                      }}
                    >
                      {child.text}
                    </a>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </nav>
      )}

      <Tooltip title={tocOpen ? "收起目录" : "展开目录"}>
        <Button
          type="default"
          shape="circle"
          className="help-toc-toggle"
          aria-label={tocOpen ? "收起目录" : "展开目录"}
          icon={tocOpen ? <MenuFoldOutlined /> : <UnorderedListOutlined />}
          onClick={() => setTocOpen((v) => !v)}
        />
      </Tooltip>
    </div>
  );
}

/**
 * 帮助窗口:以 Markdown 渲染仓库根目录的 README.md。
 *
 * README 通过 Vite 的 ?raw 在构建期内联 —— 改 README 后 dev 有热更新,
 * 发布版重新构建即同步,运行时不需要额外的文件读取通道。
 */
export default function HelpModal({ open, onClose }: HelpModalProps) {
  return (
    <Modal
      title="帮助"
      open={open}
      onCancel={onClose}
      footer={null}
      width={900}
      styles={{
        body: {
          // 滚动交给正文列和目录列各自处理,弹窗本身不滚
          padding: 0,
          overflow: "hidden",
        },
      }}
    >
      <HelpContent />
    </Modal>
  );
}
