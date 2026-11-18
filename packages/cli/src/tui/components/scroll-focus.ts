import type { DOMElement } from "ink";
import { createContext, type RefObject, useContext, useLayoutEffect } from "react";

export const ScrollFocusContext = createContext<((node: DOMElement) => void) | null>(null);

/**
 * Keep the active field or selected list row in its nearest scrolling viewport.
 *
 * Only the focused row measures. Ink computes the layout of each commit before the layout effects run,
 * so the effect can measure the row without `useBoxMetrics`. That hook would measure each mounted row
 * after each commit. A new `reveal` from `ScrollBody` (its size changed) runs the effect again.
 */
export function useScrollFocus(ref: RefObject<DOMElement | null>, focused: boolean): void {
  const reveal = useContext(ScrollFocusContext);

  useLayoutEffect(() => {
    if (focused && ref.current?.yogaNode) {
      reveal?.(ref.current);
    }
  }, [focused, ref, reveal]);
}
