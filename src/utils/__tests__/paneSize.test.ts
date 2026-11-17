import { describe, test, expect } from "vitest";
import { isPaneSizeAuthority } from "../paneSize";
import type { Pane } from "../../types";

const pane = (id: string, openTabIds: string[], activeTabId: string | null): Pane => ({
  id,
  openTabIds,
  activeTabId,
});

describe("isPaneSizeAuthority — 终端尺寸推送归属", () => {
  test("独占 PTY 的会话：无论面板是否 active，都由本面板推尺寸", () => {
    const panes = [
      pane("left", ["tab-a"], "tab-a"),
      pane("right", ["tab-b"], "tab-b"),
    ];
    // active 是右面板，左面板的 tab-a 独占自己的 PTY → 仍是权威
    expect(isPaneSizeAuthority(panes, "right", "left", "tab-a")).toBe(true);
    expect(isPaneSizeAuthority(panes, "right", "right", "tab-b")).toBe(true);
  });

  test("单一面板：唯一实例是权威", () => {
    const panes = [pane("only", ["tab-a"], "tab-a")];
    expect(isPaneSizeAuthority(panes, "only", "only", "tab-a")).toBe(true);
    expect(isPaneSizeAuthority(panes, null, "only", "tab-a")).toBe(true);
  });

  test("双开共享同一 PTY：只有 active 面板中正在显示它的实例推尺寸", () => {
    const panes = [
      pane("left", ["tab-a"], "tab-a"),
      pane("right", ["tab-a"], "tab-a"),
    ];
    expect(isPaneSizeAuthority(panes, "left", "left", "tab-a")).toBe(true);
    expect(isPaneSizeAuthority(panes, "left", "right", "tab-a")).toBe(false);
    expect(isPaneSizeAuthority(panes, "right", "right", "tab-a")).toBe(true);
    expect(isPaneSizeAuthority(panes, "right", "left", "tab-a")).toBe(false);
  });

  test("双开共享：active 面板未显示该标签时，退化为任一正在显示它的面板", () => {
    const panes = [
      pane("left", ["tab-a", "tab-x"], "tab-x"),
      pane("right", ["tab-a"], "tab-a"),
    ];
    // active 是 left，但它显示的是 tab-x → 权威落在 right
    expect(isPaneSizeAuthority(panes, "left", "right", "tab-a")).toBe(true);
    expect(isPaneSizeAuthority(panes, "left", "left", "tab-a")).toBe(false);
  });

  test("双开共享：没有任何面板正在显示该标签时，不推尺寸", () => {
    const panes = [
      pane("left", ["tab-a", "tab-x"], "tab-x"),
      pane("right", ["tab-a", "tab-y"], "tab-y"),
    ];
    expect(isPaneSizeAuthority(panes, "left", "left", "tab-a")).toBe(false);
    expect(isPaneSizeAuthority(panes, "left", "right", "tab-a")).toBe(false);
  });

  test("双开共享：恰好一个权威实例，不会两边都推", () => {
    const panes = [
      pane("left", ["tab-a"], "tab-a"),
      pane("right", ["tab-a"], "tab-a"),
    ];
    for (const activePaneId of ["left", "right", null]) {
      const authorities = panes.filter((p) =>
        isPaneSizeAuthority(panes, activePaneId, p.id, "tab-a"),
      );
      expect(authorities.length, `activePaneId=${activePaneId}`).toBe(1);
    }
  });

  test("分屏下不同 pane 的独立会话：两个都是权威（各自跟随窗口）", () => {
    const panes = [
      pane("left", ["tab-a"], "tab-a"),
      pane("right", ["tab-b"], "tab-b"),
    ];
    const authorities = panes.filter((p) =>
      isPaneSizeAuthority(panes, "left", p.id, p.openTabIds[0]),
    );
    expect(authorities.map((p) => p.id)).toEqual(["left", "right"]);
  });
});
