import { createContext, useContext } from "react";

/** The room a screen has: the main area, or the inside of the modal it is shown in. */
export interface Layout {
  readonly width: number;
  /** Lines available, when the app fills a real terminal; `undefined` when it grows with its content. */
  readonly height?: number;
}

export const LayoutContext = createContext<Layout>({ width: 80 });

/** The room of the screen that renders. */
export function useLayout(): Layout {
  return useContext(LayoutContext);
}
