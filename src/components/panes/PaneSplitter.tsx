import { useRef, useState, useEffect, useCallback } from "react";

interface PaneSplitterProps {
  /** 当前分屏比例，0~1 */
  ratio: number;
  onRatioChange: (next: number) => void;
  /** 父容器 ref，用于把鼠标位置换算为比例 */
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * 垂直拖动条：拖动后改变左侧面板宽度比例（0.2~0.8）。
 * 用 4px 透明 hit-area + 视觉 1px 中线的"双层"做法，方便用户命中。
 */
export default function PaneSplitter({ ratio, onRatioChange, containerRef }: PaneSplitterProps) {
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startRatio = useRef(ratio);
  const containerWidth = useRef(0);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const container = containerRef.current;
      if (!container) return;
      containerWidth.current = container.getBoundingClientRect().width;
      startX.current = e.clientX;
      startRatio.current = ratio;
      setDragging(true);
    },
    [ratio, containerRef],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - startX.current;
      const delta = dx / containerWidth.current;
      const next = Math.max(0.2, Math.min(0.8, startRatio.current + delta));
      onRatioChange(next);
    };
    const onUp = () => setDragging(false);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [dragging, onRatioChange]);

  return (
    <div
      onMouseDown={onMouseDown}
      className={`flex-shrink-0 relative cursor-col-resize group ${dragging ? "" : ""}`}
      style={{
        width: 4,
        backgroundColor: dragging ? "var(--ant-color-primary)" : "var(--ant-color-border-secondary)",
        transition: dragging ? "none" : "background-color 0.15s",
      }}
      title="拖动调整面板宽度"
    >
      {/* 加宽的命中区，避免 4px 太窄难命中 */}
      <div
        className="absolute inset-y-0"
        style={{ left: -4, right: -4, cursor: "col-resize" }}
      />
      {/* 视觉中线（hover 时高亮） */}
      <div
        className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 transition-colors"
        style={{
          backgroundColor: dragging ? "var(--ant-color-primary)" : "transparent",
        }}
      />
    </div>
  );
}
