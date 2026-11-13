import type { ReactNode } from "react";

export interface SelectItem<T = string> {
  value: T;
  label: string;
  /** Shown right after the label, before the description, for a status with a colour of its own. */
  tag?: ReactNode;
  /** Shown dimmed after the label. */
  description?: string;
  /** Multi-select mode: `space` does not change this item. */
  locked?: boolean;
}

export interface SelectListProps<T> {
  items: readonly SelectItem<T>[];
  /** Single mode: `enter` picks the highlighted item. */
  onSelect?(item: SelectItem<T>): void;
  /** Called with the highlighted item whenever it changes, so a screen's own keys can act on it. */
  onHighlight?(item: SelectItem<T> | undefined): void;
  /** Reports whether the list is capturing filter text; false when filtering ends or it unmounts. */
  onFilteringChange?(filtering: boolean): void;
  /** Multi-select mode: `space` toggles, `enter` submits the checked values. */
  multi?: boolean;
  /** Initially checked values in multi-select mode. */
  defaultSelected?: readonly T[];
  /** The item that is highlighted first. */
  defaultIndex?: number;
  onChange?(values: T[]): void;
  onSubmit?(values: T[]): void;
  /** Shown when there are no items at all. */
  emptyText?: string;
  /** Visible rows; the list scrolls past this. */
  limit?: number;
  isActive?: boolean;
}
