import { clampOffset } from "../scroll-offset.js";

/** The lines of all rows and the line where the cursor row starts. */
export interface RowMeasure {
  readonly total: number;
  readonly cursorTop: number;
  readonly cursorHeight: number;
}

/** The rows that have a line in the view: `first` up to, but not including, `end`. */
export interface RowRange {
  readonly first: number;
  readonly end: number;
  /** The lines of the first row that are above the view. */
  readonly skip: number;
}

interface MeasureScan extends RowMeasure {
  readonly index: number;
}

interface RangeScan extends RowRange {
  readonly top: number;
}

function measureRow(scan: MeasureScan, height: number, cursor: number): MeasureScan {
  const isCursor = scan.index === cursor;

  return {
    index: scan.index + 1,
    total: scan.total + height,
    cursorTop: isCursor ? scan.total : scan.cursorTop,
    cursorHeight: isCursor ? height : scan.cursorHeight,
  };
}

/** The lines of all rows, and the top line and the height of the `cursor` row, in one pass. */
export function measureRows(heights: readonly number[], cursor: number | undefined): RowMeasure {
  const start: MeasureScan = { index: 0, total: 0, cursorTop: 0, cursorHeight: 0 };
  const { total, cursorTop, cursorHeight } = heights.reduce(
    (scan, height) => measureRow(scan, height, cursor ?? -1),
    start,
  );

  return { total, cursorTop, cursorHeight };
}

/** The lines that the rows can use: one line less for the position line when the rows do not fit. */
export function viewRoom(total: number, height: number | undefined): number | undefined {
  if (height === undefined) {
    return undefined;
  }

  return total > height ? Math.max(1, height - 1) : height;
}

/** The smallest change of `offset` that brings the lines `top` to `top + size` into a view of `room` lines. */
export function revealOffset(offset: number, top: number, size: number, room: number, max: number): number {
  const start = Math.min(offset, max);

  if (top < start) {
    return clampOffset(top, max);
  }

  return top + size > start + room ? clampOffset(top + size - room, max) : start;
}

function rangeRow(scan: RangeScan, height: number, index: number, start: number, end: number): RangeScan {
  const bottom = scan.top + height;
  const isFirst = scan.first < 0 && bottom > start;

  return {
    top: bottom,
    first: isFirst ? index : scan.first,
    skip: isFirst ? start - scan.top : scan.skip,
    end: scan.top < end ? index + 1 : scan.end,
  };
}

/** The rows that have a line between `start` and `start + room`. */
export function rowsInView(heights: readonly number[], start: number, room: number): RowRange {
  const initial: RangeScan = { top: 0, first: -1, end: 0, skip: 0 };
  const { first, end, skip } = heights.reduce(
    (scan, height, index) => rangeRow(scan, height, index, start, start + room),
    initial,
  );

  return first < 0 ? { first: 0, end: 0, skip: 0 } : { first, end, skip };
}
