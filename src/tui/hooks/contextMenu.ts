import { createContext, useContext } from 'react';

/** One item of a context menu: what it runs when picked. */
export interface ContextMenuItem {
  label: string;
  onSelect(): void;
  /** Shown but not picked, e.g. a move past the last Stage. */
  disabled?: boolean;
  /** The key that does the same on the screen, shown beside the label. */
  key?: string;
}

/**
 * Opens a context menu at a terminal cell, such as where a right click landed. The shell draws it over
 * everything; while it is open the screens below take no keys and no clicks.
 */
export interface ContextMenuControl {
  open(x: number, y: number, items: readonly ContextMenuItem[]): void;
  close(): void;
}

/** Does nothing outside the shell. */
export const ContextMenuContext = createContext<ContextMenuControl>({ open() {}, close() {} });

export function useContextMenu(): ContextMenuControl {
  return useContext(ContextMenuContext);
}
