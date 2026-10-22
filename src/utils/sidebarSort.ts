import type { Session, SessionCategory } from "../types";
import type { SessionMove } from "./ipc";

export const SIDEBAR_DND_MIME = "application/x-teacoder-sidebar";

export type SidebarDragKind = "session" | "category" | "project";

export interface SidebarDrag {
  kind: SidebarDragKind;
  id: string;
}

export function writeDragPayload(e: React.DragEvent, payload: SidebarDrag) {
  e.dataTransfer.setData(SIDEBAR_DND_MIME, JSON.stringify(payload));
  // 部分浏览器要求同时给出 text/plain 才允许触发 drop
  e.dataTransfer.setData("text/plain", payload.id);
}

export function readDragPayload(e: React.DragEvent): SidebarDrag | null {
  const raw = e.dataTransfer.getData(SIDEBAR_DND_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SidebarDrag;
    if (typeof parsed.id === "string" && typeof parsed.kind === "string") return parsed;
  } catch {
    // 不是我们的载荷
  }
  return null;
}

/**
 * 把 `draggedId` 从 `ids` 里摘出，插到 `targetId` 的前 / 后，返回新的完整顺序。
 * `targetId` 不在列表里就原样返回 —— 拖拽过程中项目列表可能被搜索过滤过。
 */
export function reorderIds(
  ids: string[],
  draggedId: string,
  targetId: string,
  after: boolean,
): string[] {
  const next = ids.filter((id) => id !== draggedId);
  const at = next.indexOf(targetId);
  if (at < 0) return ids;
  next.splice(after ? at + 1 : at, 0, draggedId);
  return next;
}

/** 分组内按展示顺序排列：排序值优先，撞车时用更新时间兜底（与后端 ORDER BY 一致）。 */
function orderedIds(all: Session[], projectId: string, categoryId: string | null): string[] {
  return all
    .filter((s) => s.projectId === projectId && (s.categoryId ?? null) === categoryId)
    .sort((a, b) => a.sortOrder - b.sortOrder || b.updatedAt - a.updatedAt)
    .map((s) => s.id);
}

/**
 * 算出把 `draggedId` 挪到目标分组第 `insertIndex` 位需要写哪些行。
 *
 * **源分组和目标分组都会被完整重编号**（各自从 0 开始）。只写被拖的那一条会留下空洞
 * 或重复值，而列表顺序又只认 sortOrder —— 撞车时后端会退回按 updated_at 排，
 * 于是"刚拖过的会话"会莫名其妙跳位。两边都重写是唯一能让顺序确定下来的做法。
 *
 * `insertIndex` 是**剔除被拖项之后**目标分组里的下标。
 *
 * 返回空数组表示位置没变，调用方可以省掉这次 IPC。
 */
export function buildSessionMoves(
  all: Session[],
  draggedId: string,
  targetProjectId: string,
  targetCategoryId: string | null,
  insertIndex: number,
): SessionMove[] {
  const dragged = all.find((s) => s.id === draggedId);
  if (!dragged) return [];

  const sourceKey: [string, string | null] = [dragged.projectId, dragged.categoryId ?? null];
  const targetKey: [string, string | null] = [targetProjectId, targetCategoryId];
  const sameGroup = sourceKey[0] === targetKey[0] && sourceKey[1] === targetKey[1];

  const sourceIds = orderedIds(all, ...sourceKey).filter((id) => id !== draggedId);
  const targetIds = orderedIds(all, ...targetKey).filter((id) => id !== draggedId);

  const clamped = Math.max(0, Math.min(insertIndex, targetIds.length));
  targetIds.splice(clamped, 0, draggedId);

  const moves: SessionMove[] = targetIds.map((id, i) => ({
    id,
    projectId: targetKey[0],
    categoryId: targetKey[1],
    sortOrder: i,
  }));

  if (!sameGroup) {
    moves.push(
      ...sourceIds.map((id, i) => ({
        id,
        projectId: sourceKey[0],
        categoryId: sourceKey[1],
        sortOrder: i,
      })),
    );
  }

  const byId = new Map(all.map((s) => [s.id, s]));
  const unchanged = moves.every((m) => {
    const s = byId.get(m.id);
    return (
      s &&
      s.projectId === m.projectId &&
      (s.categoryId ?? null) === (m.categoryId ?? null) &&
      s.sortOrder === m.sortOrder
    );
  });
  return unchanged ? [] : moves;
}

/**
 * 会话落点 → 目标分组与插入下标。
 *
 * `after` 是落在该行的下半区。会话行的上下半就是"插到它前面 / 后面";分类行与项目行
 * 本身不在任何一个会话分组里,它们的上下半分别对应该分组的**第一位**与**最后一位**
 * —— 即拖到分类上半 = 排进这个分类的最前,下半 = 追加到这个分类的末尾。
 */
export function resolveSessionDrop(
  all: Session[],
  categories: SessionCategory[],
  draggedId: string,
  rowKind: "session" | "category" | "project",
  rowId: string,
  after: boolean,
): { projectId: string; categoryId: string | null; index: number } | null {
  if (rowKind === "session") {
    const target = all.find((s) => s.id === rowId);
    if (!target) return null;
    const group = orderedIds(all, target.projectId, target.categoryId ?? null).filter(
      (id) => id !== draggedId,
    );
    const at = group.indexOf(rowId);
    if (at < 0) return null;
    return {
      projectId: target.projectId,
      categoryId: target.categoryId ?? null,
      index: after ? at + 1 : at,
    };
  }

  if (rowKind === "category") {
    const category = categories.find((c) => c.id === rowId);
    if (!category) return null;
    const group = orderedIds(all, category.projectId, category.id).filter(
      (id) => id !== draggedId,
    );
    return { projectId: category.projectId, categoryId: category.id, index: after ? group.length : 0 };
  }

  // 项目根目录：未分类会话单独成组
  const group = orderedIds(all, rowId, null).filter((id) => id !== draggedId);
  return { projectId: rowId, categoryId: null, index: after ? group.length : 0 };
}