import type { Layout } from '../hooks';

/** The narrowest a generic Modal is drawn, room allowing; it grows with its content up to its `maxWidth`. */
export const MODAL_MIN_WIDTH = 48;

/**
 * The size of a modal in `outer`: its widest (a screen modal is always that wide), the most lines it
 * may take (`undefined` when it is not shown over anything) and the room inside its body, for
 * content that fills it.
 */
export function modalSize(
  outer: Layout,
  {
    size = 'panel',
    maxWidth = size === 'screen' ? 120 : 72,
    footer,
  }: { size?: 'panel' | 'dialog' | 'screen'; maxWidth?: number; footer: boolean },
): { width: number; room?: number; body: Layout } {
  const width = Math.max(30, Math.min(maxWidth, outer.width - 2));
  const room = outer.height === undefined ? undefined : Math.max(8, outer.height - 2);
  // Border (the title sits in it), hint bar with its rule, body padding.
  const chrome = 2 + (footer ? 2 : 0) + 2;
  return { width, room, body: { width: width - 6, height: room === undefined ? undefined : room - chrome } };
}
