import { ERR_TOO_MANY_OPEN_TABS } from "../stores/appStore";

/** store 抛出的是哨兵码而非文案，文案与展示方式收口在这里 */
interface MessageLike {
  error: (content: string) => void;
  warning: (content: string) => void;
}

/** openTab 的失败原因对用户可见化；未知错误静默（由各自的业务上下文负责） */
export function reportOpenTabError(message: MessageLike, err: unknown) {
  const code = (err as { message?: string } | null)?.message;
  if (code === "SESSION_DELETED") {
    message.error("会话被删除或不存在");
  } else if (code === ERR_TOO_MANY_OPEN_TABS) {
    message.warning("打开的会话窗口过多，占用系统资源，请先关闭非必要的窗口");
  }
}