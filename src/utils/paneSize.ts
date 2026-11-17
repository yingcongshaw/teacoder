import type { Pane } from "../types";

/**
 * 判断某面板中的某标签是否为「终端尺寸推送权威实例」。
 *
 * 后端一个 tabId 对应一个 PTY，PTY 只能有一套 cols/rows。
 * 多个 xterm 实例若都推尺寸，两路尺寸会互相覆盖，PTY 在两个值之间
 * 反复跳变，触发 SIGWINCH 风暴（Claude Code 反复重排版、历史被吐）。
 *
 * 但「一个 pane 一个开关」的一刀切会让分屏下另一个面板的会话
 * 尺寸永久冻结 —— 那些会话各自拥有独立 PTY，本应各自跟随窗口。
 * 因此判据必须是「这个 PTY 有几个实例」，而不是「这个面板是不是 active」：
 *
 * - 只存在于一个面板 → 独占自己的 PTY，尺寸由它推，永远跟随窗口。
 * - 存在于多个面板（双开共享 PTY）→ 由 active 面板中正在显示它的实例推，
 *   其余实例不推，避免尺寸竞争。
 */
export function isPaneSizeAuthority(
  panes: Pane[],
  activePaneId: string | null,
  paneId: string,
  tabId: string,
): boolean {
  const owners = panes.filter((p) => p.openTabIds.includes(tabId));
  // 独占：没有别的实例共享这个 PTY
  if (owners.length <= 1) return true;
  // 共享：优先 active 面板中正在显示该标签的实例，
  // active 面板没在显示它时退化为任意一个正在显示它的面板
  const authority =
    owners.find((p) => p.id === activePaneId && p.activeTabId === tabId) ??
    owners.find((p) => p.activeTabId === tabId);
  return authority?.id === paneId;
}
