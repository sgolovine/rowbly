import type { Dispatch, SetStateAction } from "react";
import { SidebarItem } from "../sidebar-item/index.js";

/** One row of a sidebar. */
export interface SidebarEntry {
  id: string;
  label: string;
  /** Shows a `✎` that calls the sidebar's `onEdit` with this entry. */
  editable?: boolean;
  /** Lets the mouse drag the entry to another row, which calls the sidebar's `onMove`. */
  movable?: boolean;
}

/** What a drag of a `movable` entry carries: its id, and the sidebar that it comes from. */
interface DraggedEntry {
  readonly sidebar: object;
  readonly id: string;
}

/** The sidebar of a row and its callbacks. */
export interface SidebarRowEnv {
  /** Tells the drags of this sidebar from the drags of other components. */
  readonly self: object;
  readonly onFocus: () => void;
  readonly onSelect: (id: string) => void;
  readonly onEdit?: (id: string) => void;
  /** The entry `id` was dropped on the row at `index`. */
  readonly onMove?: (id: string, index: number) => void;
  /** The id of the row that a drag is over. */
  readonly setOver: Dispatch<SetStateAction<string | null>>;
}

export interface SidebarRowProps {
  readonly entry: SidebarEntry;
  /** The index of the entry in the sidebar. */
  readonly index: number;
  readonly selected: boolean;
  readonly numbered: boolean;
  readonly clickable: boolean;
  /** A drag of another row is over this row. */
  readonly dropTarget: boolean;
  readonly env: SidebarRowEnv;
}

function isDragged(self: object, value: unknown): value is DraggedEntry {
  return (value as DraggedEntry | null)?.sidebar === self;
}

function selectRow(env: SidebarRowEnv, id: string): void {
  env.onFocus();
  env.onSelect(id);
}

function editRow(env: SidebarRowEnv, id: string): void {
  env.onFocus();
  env.onEdit?.(id);
}

/** Moves a dragged entry of this sidebar to the row at `index`. A drop on the row of the entry does nothing. */
function dropOnRow(env: SidebarRowEnv, value: unknown, entry: SidebarEntry, index: number): void {
  env.setOver(null);

  if (!isDragged(env.self, value) || value.id === entry.id) {
    return;
  }

  env.onFocus();
  env.onMove?.(value.id, index);
}

/** A `SidebarItem` for one entry, with the clicks, the edit and the drag and drop of the sidebar. */
export function SidebarRow({ entry, index, selected, numbered, clickable, dropTarget, env }: SidebarRowProps) {
  const { self, onEdit, onMove, setOver } = env;

  return (
    <SidebarItem
      index={numbered ? index : undefined}
      name={entry.label}
      selected={selected}
      clickable={clickable}
      onClick={() => selectRow(env, entry.id)}
      onEdit={onEdit && entry.editable ? () => editRow(env, entry.id) : undefined}
      drag={onMove && entry.movable ? ({ sidebar: self, id: entry.id } satisfies DraggedEntry) : undefined}
      onDrop={onMove ? (value) => dropOnRow(env, value, entry, index) : undefined}
      onDragOver={(value) => setOver(isDragged(self, value) ? entry.id : null)}
      onDragLeave={() => setOver((id) => (id === entry.id ? null : id))}
      dropTarget={dropTarget}
    />
  );
}
