import { openUrl } from "@tauri-apps/plugin-opener";
import { message } from "antd";

/**
 * 在系统浏览器中打开链接。
 *
 * 只放行 http/https —— 正文可能来自 AI 生成的文本,不能让它诱导 opener 打开
 * file:// 之类的本地协议或执行任意 scheme。
 */
export async function openExternal(href: string | undefined): Promise<void> {
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
 * 打开邮件客户端。
 *
 * mailto: 只能唤起邮件程序,不会执行任意协议,单独放行。
 */
export async function openMailto(href: string): Promise<void> {
  try {
    await openUrl(href);
  } catch {
    message.warning("无法打开邮件客户端");
  }
}
