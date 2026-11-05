export interface GithubRelease {
  /** 版本标签，如 v0.1.2 */
  tagName: string;
  /** 标题，可能为空 */
  name: string;
  /** 更新说明（Markdown 原文） */
  body: string;
  /** Release 页面地址 */
  htmlUrl: string;
  /** 发布时间，ISO 字符串 */
  publishedAt: string;
}

const REPO = "yingcongshaw/teacoder";
const API_PATH = `repos/${REPO}/releases/latest`;

/**
 * 依次尝试的取版本地址。直连 GitHub API 在部分网络下会超时，
 * 后面是它的代理镜像，任一成功即可。
 */
const ENDPOINTS = [
  `https://api.github.com/${API_PATH}`,
  `https://gh-proxy.com/https://api.github.com/${API_PATH}`,
];

const REQUEST_TIMEOUT_MS = 8000;

const NOTIFY_KEY = "teacoder_update_notify";

/** 拉取最新的 Release。全部地址都失败时返回 null。 */
export async function fetchLatestRelease(): Promise<GithubRelease | null> {
  for (const url of ENDPOINTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!response.ok) continue;
      const data = (await response.json()) as Record<string, unknown>;
      if (!data || typeof data.tag_name !== "string") continue;
      return {
        tagName: data.tag_name,
        name: typeof data.name === "string" ? data.name : data.tag_name,
        body: typeof data.body === "string" ? data.body : "",
        htmlUrl:
          typeof data.html_url === "string"
            ? data.html_url
            : `https://github.com/${REPO}/releases`,
        publishedAt: typeof data.published_at === "string" ? data.published_at : "",
      };
    } catch {
      // 换下一个地址
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/**
 * 比较两个版本号，返回 1 / 0 / -1。
 * 只看数字段，v 前缀和预发布后缀不参与比较 —— 发布用的是 vX.Y.Z。
 */
export function compareVersions(a: string, b: string): number {
  const parse = (version: string) =>
    version
      .trim()
      .replace(/^v/i, "")
      .split(/[.+-]/)
      .map((part) => {
        const n = parseInt(part, 10);
        return Number.isNaN(n) ? 0 : n;
      });

  const left = parse(a);
  const right = parse(b);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i++) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l !== r) return l > r ? 1 : -1;
  }
  return 0;
}

/** 是否开启更新通知，默认开。 */
export function getUpdateNotifyEnabled(): boolean {
  try {
    const raw = localStorage.getItem(NOTIFY_KEY);
    return raw === null ? true : raw === "true";
  } catch {
    return true;
  }
}

export function saveUpdateNotifyEnabled(value: boolean): void {
  try {
    localStorage.setItem(NOTIFY_KEY, String(value));
  } catch {
    // 写不进去也不影响本次会话
  }
}
