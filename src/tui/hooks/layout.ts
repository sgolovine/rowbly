import { createContext, useContext } from 'react';
import type { Slug } from '../../schemas';

/** The room a screen has: the main area, or the inside of the modal it is shown in. */
export interface Layout {
  width: number;
  /** Lines available, when the app fills a real terminal; `undefined` when it grows with its content. */
  height?: number;
}

export const LayoutContext = createContext<Layout>({ width: 80 });

export function useLayout(): Layout {
  return useContext(LayoutContext);
}

/** The Board picked in the sidebar. `version` changes on every switch so screens can reload. */
export interface BoardSelection {
  version: number;
  /** Makes `boardId` the Board in context. Errors become toasts. */
  select(boardId: Slug): Promise<void>;
}

export const BoardSelectionContext = createContext<BoardSelection>({ version: 0, select: async () => {} });

export function useBoardSelection(): BoardSelection {
  return useContext(BoardSelectionContext);
}
