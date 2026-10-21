import { type DOMElement, useBoxMetrics } from 'ink';
import { createContext, type RefObject, useContext, useLayoutEffect } from 'react';

export const ScrollFocusContext = createContext<((node: DOMElement) => void) | null>(null);

/** Keep the active field or selected list row in its nearest scrolling viewport. */
export function useScrollFocus(ref: RefObject<DOMElement | null>, focused: boolean): void {
  const reveal = useContext(ScrollFocusContext);
  const { hasMeasured } = useBoxMetrics(ref);
  useLayoutEffect(() => {
    if (focused && hasMeasured && ref.current) reveal?.(ref.current);
  }, [focused, ref, reveal, hasMeasured]);
}
