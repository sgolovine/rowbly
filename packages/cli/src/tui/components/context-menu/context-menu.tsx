import { Box, type DOMElement, type Key, useInput } from "ink";
import { type Dispatch, type SetStateAction, useRef, useState } from "react";
import { useIsActive, useKeyCapture, useLayout, useMouse } from "../../hooks/index.js";
import { moveDelta } from "../../keymap.js";
import { theme } from "../../theme.js";
import { ContextMenuRow } from "../context-menu-row/index.js";
import { type ContextMenuItem, firstEnabled, menuPlace, menuSize, stepCursor } from "./context-menu-view.js";

export interface ContextMenuProps {
  readonly items: readonly ContextMenuItem[];
  /** The cell below the pointer, on the screen. It is the top-left corner of the menu, if the menu fits there. */
  readonly x: number;
  readonly y: number;
  /** Runs the item at `index`, after the menu closes. Only an item that applies runs. */
  onRun(index: number): void;
  onClose(): void;
}

interface MenuEnv {
  readonly items: readonly ContextMenuItem[];
  readonly cursor: number;
  readonly setCursor: Dispatch<SetStateAction<number>>;
  readonly onRun: (index: number) => void;
  readonly onClose: () => void;
}

/** Closes the menu and runs the item at `index`, when it applies. */
function runItem(env: MenuEnv, index: number): void {
  const item = env.items[index];

  if (!item || item.disabled) {
    return;
  }

  env.onClose();
  env.onRun(index);
}

/** The pointer on an item that applies highlights it. */
function pointItem(env: MenuEnv, index: number): void {
  if (!env.items[index]?.disabled) {
    env.setCursor(index);
  }
}

function handleMenuKey(env: MenuEnv, input: string, key: Key): void {
  if (key.escape) {
    env.onClose();

    return;
  }

  if (key.return) {
    runItem(env, env.cursor);

    return;
  }

  const delta = moveDelta(input, key);

  if (delta !== 0) {
    env.setCursor((cursor) => stepCursor(env.items, cursor, delta));
  }
}

/** A click or a right click on the frame of the menu does nothing. */
function ignore(): void {
  // The frame takes the click, so that it does not go to the box below the menu.
}

/**
 * A list of items in a `border-round` frame in `accent`, with the `overlay` fill, at the cell `x`, `y` of the screen.
 * The menu moves in from the edges of the screen so that all of it shows. Render it at the root of the screen, after
 * all other content, so that it is on top. `↑/↓` and `j/k` move the highlight past the items that do not apply, and so
 * does the pointer. `enter` or a click runs the highlighted item and closes the menu. `esc`, a click or a right click
 * outside the menu only close it: a transparent box on the full screen takes that click.
 */
export function ContextMenu({ items, x, y, onRun, onClose }: ContextMenuProps) {
  const active = useIsActive();
  const screen = useLayout();
  const [cursor, setCursor] = useState(() => firstEnabled(items));
  const backdrop = useRef<DOMElement>(null);
  const frame = useRef<DOMElement>(null);

  const size = menuSize(items);
  const place = menuPlace(x, y, size, screen);
  const env: MenuEnv = { items, cursor, setCursor, onRun, onClose };

  useKeyCapture(active, { escape: true });
  useInput((input, key) => handleMenuKey(env, input, key), { isActive: active });
  useMouse(backdrop, { onClick: onClose, onMenu: onClose }, active);
  useMouse(frame, { onClick: ignore, onMenu: ignore }, active);

  return (
    <>
      <Box ref={backdrop} position="absolute" top={0} left={0} width={screen.width} height={screen.height ?? 0} />
      <Box
        ref={frame}
        position="absolute"
        top={place.top}
        left={place.left}
        width={size.width}
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.accent}
        backgroundColor={theme.overlay}
      >
        {items.map((item, index) => (
          <ContextMenuRow
            key={item.label}
            item={item}
            highlighted={index === cursor}
            active={active}
            onPoint={() => pointItem(env, index)}
            onRun={() => runItem(env, index)}
          />
        ))}
      </Box>
    </>
  );
}
