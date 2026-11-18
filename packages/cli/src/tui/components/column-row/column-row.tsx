import { Box } from "ink";
import { Fragment, type ReactNode } from "react";
import { theme } from "../../theme.js";
import { SelectionRow } from "../selection-row/index.js";

/** One cell of a `ColumnRow`. */
export interface RowColumn {
  /** The fixed width of the cell. A cell with no width can shrink, so that its text can truncate. */
  readonly width?: number;
  /** The cell, or a function that makes the cell from the selected state of the row. */
  readonly content: ReactNode | ((selected: boolean) => ReactNode);
}

/** The props of `ColumnRow`. */
export interface ColumnRowProps {
  readonly selected: boolean;
  /** False while a different region has the keys; then the row does not take a click. */
  readonly active: boolean;
  readonly onClick?: () => void;
  readonly columns: readonly RowColumn[];
}

/** The colour of a secondary cell. `ink-faint` is not on the `selection` fill. */
export function subtleColor(selected: boolean): string {
  return selected ? theme.inkMuted : theme.inkFaint;
}

function cellContent(column: RowColumn, selected: boolean): ReactNode {
  return typeof column.content === "function" ? column.content(selected) : column.content;
}

function renderCell(column: RowColumn, index: number, selected: boolean): ReactNode {
  const content = cellContent(column, selected);

  if (column.width === undefined) {
    return <Fragment key={index}>{content}</Fragment>;
  }

  return (
    <Box key={index} width={column.width} flexShrink={0}>
      {content}
    </Box>
  );
}

/** A `SelectionRow` with cells side by side. Each cell with a width keeps its width. */
export function ColumnRow({ selected, active, onClick, columns }: ColumnRowProps) {
  return (
    <SelectionRow selected={selected} active={active} onClick={onClick}>
      <Box>{columns.map((column, index) => renderCell(column, index, selected))}</Box>
    </SelectionRow>
  );
}
