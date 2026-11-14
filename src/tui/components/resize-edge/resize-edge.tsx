import { Box, type DOMElement, measureElement } from "ink";
import { type RefObject, useRef } from "react";
import { useMouse } from "../../hooks/index.js";

/** The edge of a box that a drag moves. */
export type EdgeSide = "left" | "right";

/** The limits and the current width of a box that a drag resizes. */
export interface ResizeBounds {
  readonly width: number;
  readonly minWidth: number;
  readonly maxWidth: number;
}

/**
 * The width of a box at column `left` with `width` columns, after a pull of its `side` edge to column `x`.
 * The column of the pointer becomes the column of the border. The width stays between the limits.
 */
export function pulledWidth(side: EdgeSide, left: number, bounds: ResizeBounds, x: number): number {
  const wanted = side === "right" ? x - left + 1 : left + bounds.width - x;

  return Math.max(bounds.minWidth, Math.min(bounds.maxWidth, wanted));
}

function pullTo(
  target: RefObject<DOMElement | null>,
  side: EdgeSide,
  bounds: ResizeBounds,
  onResize: (width: number) => void,
  x: number,
): void {
  const left = target.current ? measureElement(target.current).x : 0;
  const next = pulledWidth(side, left, bounds, x);

  if (next !== bounds.width) {
    onResize(next);
  }
}

interface ResizeEdgeProps extends ResizeBounds {
  /** The box that the edge resizes. Its parent must hold the edge. */
  readonly target: RefObject<DOMElement | null>;
  readonly side: EdgeSide;
  readonly active: boolean;
  onResize(width: number): void;
}

/**
 * The edge of a box that the mouse drags to change the width of the box: its border and the gap beside it.
 * Put it in the box that it resizes, after the content. A pull calls `onResize` with the new width.
 */
export function ResizeEdge({ target, side, active, onResize, ...bounds }: ResizeEdgeProps) {
  const edge = useRef<DOMElement>(null);
  const place = side === "right" ? { right: -1 } : { left: -1 };

  useMouse(edge, { onPull: (x) => pullTo(target, side, bounds, onResize, x) }, active);

  return <Box ref={edge} position="absolute" top={0} {...place} width={2} height="100%" />;
}
