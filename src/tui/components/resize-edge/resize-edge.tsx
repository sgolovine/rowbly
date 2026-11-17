import { Box, type DOMElement, measureElement } from "ink";
import { type RefObject, useRef } from "react";
import { useMouse } from "../../hooks/index.js";

/** The edge of a box that a drag moves. A `left` or `right` edge changes the width, a `top` edge the height. */
type EdgeSide = "left" | "right" | "top";

/** The limits and the current size of a box that a drag resizes: its columns, or its rows for a `top` edge. */
interface ResizeBounds {
  readonly size: number;
  readonly minSize: number;
  readonly maxSize: number;
}

/**
 * The size of a box that starts at `start` (its column, or its row for a `top` edge), after a pull of its `side`
 * edge to `to`. The cell of the pointer becomes the cell of the border. The size stays between the limits.
 */
function pulledSize(side: EdgeSide, start: number, bounds: ResizeBounds, to: number): number {
  const wanted = side === "right" ? to - start + 1 : start + bounds.size - to;

  return Math.max(bounds.minSize, Math.min(bounds.maxSize, wanted));
}

/** The column of the box for a `left` or `right` edge, or its row for a `top` edge. */
function startOf(target: RefObject<DOMElement | null>, side: EdgeSide): number {
  if (!target.current) {
    return 0;
  }

  const box = measureElement(target.current);

  return side === "top" ? box.y : box.x;
}

function pullTo(
  target: RefObject<DOMElement | null>,
  side: EdgeSide,
  bounds: ResizeBounds,
  onResize: (size: number) => void,
  pointer: { readonly x: number; readonly y: number },
): void {
  const next = pulledSize(side, startOf(target, side), bounds, side === "top" ? pointer.y : pointer.x);

  if (next !== bounds.size) {
    onResize(next);
  }
}

/** The place of the edge in the box: the border and the gap beside it. */
function placeOf(side: EdgeSide) {
  if (side === "top") {
    return { top: -1, left: 0, width: "100%", height: 2 } as const;
  }

  const place = side === "right" ? { right: -1 } : { left: -1 };

  return { ...place, top: 0, width: 2, height: "100%" } as const;
}

interface ResizeEdgeProps extends ResizeBounds {
  /** The box that the edge resizes. Its parent must hold the edge. */
  readonly target: RefObject<DOMElement | null>;
  readonly side: EdgeSide;
  readonly active: boolean;
  onResize(size: number): void;
}

/**
 * The edge of a box that the mouse drags to change the size of the box: its border and the gap beside it. A `left`
 * or `right` edge changes the width, and a `top` edge changes the height. Put it in the box that it resizes, after
 * the content. A pull calls `onResize` with the new size.
 */
export function ResizeEdge({ target, side, active, onResize, ...bounds }: ResizeEdgeProps) {
  const edge = useRef<DOMElement>(null);

  useMouse(edge, { onPull: (x, y) => pullTo(target, side, bounds, onResize, { x, y }) }, active);

  return <Box ref={edge} position="absolute" {...placeOf(side)} />;
}
