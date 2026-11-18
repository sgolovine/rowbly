import type { EventEmitter } from "node:events";
import type { DOMElement } from "ink";
import { createContext, type RefObject, useContext, useEffect } from "react";
import type { MouseEvent } from "../mouse.js";
import type { MouseHandlers, MouseRegistry } from "./mouse.js";
import { useLatest } from "./refs.js";

export const MouseContext = createContext<MouseRegistry | null>(null);

/** Restricts descendant mouse targets to the visible cells of a borderless viewport. */
const MouseClipContext = createContext<RefObject<DOMElement | null> | null>(null);

/** Gives one listener for the `on` and the `off` of a mouse source. */
function mouseListener(registry: MouseRegistry): (event: MouseEvent) => void {
  return (event) => registry.dispatch(event);
}

/** Gives one listener for the `on` and the `off` of the layout commits of a mouse source. */
function layoutListener(registry: MouseRegistry): () => void {
  return () => registry.invalidate();
}

/**
 * Feeds the reports from a `MouseStdin` into the registry until unmounted. A `layout` event on the
 * source tells the registry that the layout changed, so that it measures the boxes again.
 */
export function useMouseSource(registry: MouseRegistry, source: EventEmitter | undefined): void {
  useEffect(() => {
    if (!source) {
      return;
    }

    const listener = mouseListener(registry);
    const onLayout = layoutListener(registry);

    source.on("mouse", listener);
    source.on("layout", onLayout);

    return () => {
      source.off("mouse", listener);
      source.off("layout", onLayout);
    };
  }, [registry, source]);
}

/** Makes the box behind `ref` respond to the mouse while `active`. */
export function useMouse(ref: RefObject<DOMElement | null>, handlers: MouseHandlers, active = true): void {
  const registry = useContext(MouseContext);
  const clip = useContext(MouseClipContext);
  const latest = useLatest(handlers);

  useEffect(
    () => (registry && active ? registry.register({ ref, handlers: latest, clip }) : undefined),
    [registry, ref, active, clip, latest],
  );
}
