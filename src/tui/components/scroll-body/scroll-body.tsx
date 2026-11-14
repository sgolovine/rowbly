import { Box, type DOMElement, type Key, measureElement, Text, useBoxMetrics, useInput } from "ink";
import {
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  useCallback,
  useRef,
  useState,
} from "react";
import { useIsActive, useMouse, writeRef } from "../../hooks/index.js";
import { theme } from "../../theme.js";
import { ScrollFocusContext } from "../scroll-focus.js";
import { clampOffset, wheelOffset } from "../scroll-offset.js";

interface ScrollBodyProps {
  children: ReactNode;
  height?: number;
  /** Page Up/Down scroll, and the wheel scrolls when `wheel` is not given. */
  active?: boolean;
  /** The wheel scrolls; the default is `active`. A list can take the wheel while a different pane has the keys. */
  wheel?: boolean;
}

/** The rows of the viewport and the setter of the first row in view. */
interface RevealEnv {
  readonly viewport: RefObject<DOMElement | null>;
  /** The rows in view; undefined when the body has no height and shows all rows. */
  readonly room: number | undefined;
  readonly max: number;
  readonly setOffset: Dispatch<SetStateAction<number>>;
}

/** The rows to scroll so that `target` is in the view: up when it is above, down when it is below. */
function revealDelta(target: { y: number; height: number }, view: { y: number }, room: number): number {
  if (target.y < view.y) {
    return target.y - view.y;
  }

  return target.y + target.height > view.y + room ? target.y + target.height - view.y - room : 0;
}

/** Scrolls the least rows that bring `node` into the view. */
function reveal(env: RevealEnv, node: DOMElement): void {
  const { room } = env;

  if (!env.viewport.current || room === undefined) {
    return;
  }

  const delta = revealDelta(measureElement(node), measureElement(env.viewport.current), room);

  if (delta) {
    env.setOffset((current) => clampOffset(current + delta, env.max));
  }
}

function pageKey(env: RevealEnv, start: number, key: Key): void {
  if (key.pageDown || key.pageUp) {
    env.setOffset(clampOffset(start + (key.pageUp ? -1 : 1) * (env.room ?? 1), env.max));
  }
}

/** A bounded viewport; Page Up/Down and the mouse wheel scroll without taking a screen's selection keys. */
export function ScrollBody({ children, height, active: enabled = true, wheel }: ScrollBodyProps) {
  const shown = useIsActive();
  const active = shown && enabled;
  const wheelOn = shown && (wheel ?? enabled);
  const ref = useRef<DOMElement>(null);
  const frame = useRef<DOMElement>(null);
  const viewport = useRef<DOMElement>(null);
  const { height: lines } = useBoxMetrics(ref);
  const [offset, setOffset] = useState(0);
  // A viewport of `height` rows limits the measure of its content to `height`. Content that overflowed and
  // now measures exactly `height` still overflows, or each render would change the answer of the one before.
  const overflowed = useRef(false);

  writeRef(overflowed, height !== undefined && (lines > height || (overflowed.current && lines === height)));

  const room = height === undefined ? undefined : Math.max(1, height - (overflowed.current ? 1 : 0));
  const max = room === undefined ? 0 : Math.max(0, lines - room);
  const start = Math.min(offset, max);
  const env: RevealEnv = { viewport, room, max, setOffset };
  const revealNode = useCallback((node: DOMElement) => reveal({ viewport, room, max, setOffset }, node), [max, room]);

  useInput((_input, key) => pageKey(env, start, key), { isActive: active && max > 0 });
  useMouse(
    frame,
    { onWheel: (direction) => setOffset((current) => wheelOffset(current, max, direction)) },
    wheelOn && max > 0,
  );

  return (
    <Box ref={frame} flexDirection="column" flexGrow={1} flexShrink={1}>
      <Box
        ref={viewport}
        flexDirection="column"
        height={room === undefined ? undefined : Math.min(room, Math.max(1, lines))}
        overflow="hidden"
        flexShrink={1}
      >
        <Box ref={ref} flexDirection="column" flexShrink={0} marginTop={-start}>
          <ScrollFocusContext.Provider value={revealNode}>{children}</ScrollFocusContext.Provider>
        </Box>
      </Box>
      {max > 0 && (
        <Text color={theme.inkFaint}>
          ↑↓ {start + 1}–{Math.min(lines, start + (room ?? 1))} of {lines} · pgup/pgdn scroll
        </Text>
      )}
    </Box>
  );
}
