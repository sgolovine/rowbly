import { createContext, useContext } from "react";

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
