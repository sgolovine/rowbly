import type { EventEmitter } from 'node:events';
import { type DOMElement, measureElement } from 'ink';
import { createContext, type RefObject, useContext, useEffect, useRef } from 'react';
import type { MouseEvent } from '../mouse';

/** What a box does when clicked, and what it accepts when something is dragged onto it. */
export interface MouseHandlers {
  onClick?(): void;
  /** Dragging starts on a press here and carries this value to the box it is released over. */
  drag?: unknown;
  onDrop?(value: unknown): void;
}

interface Target {
  ref: RefObject<DOMElement | null>;
  handlers: RefObject<MouseHandlers>;
}

/** The clickable boxes on screen. A press goes to the smallest box under the pointer. */
export interface MouseRegistry {
  register(target: Target): () => void;
  dispatch(event: MouseEvent): void;
}

export function createMouseRegistry(): MouseRegistry {
  const targets = new Set<Target>();
  let dragging: { value: unknown; from: Target } | null = null;

  const hit = (event: MouseEvent, wants: (h: MouseHandlers) => boolean): Target | undefined => {
    let best: { target: Target; area: number } | undefined;
    for (const target of targets) {
      const node = target.ref.current;
      if (!node || !wants(target.handlers.current)) continue;
      const box = measureElement(node);
      const inside =
        event.x >= box.x && event.x < box.x + box.width && event.y >= box.y && event.y < box.y + box.height;
      const area = box.width * box.height;
      if (inside && area > 0 && (!best || area < best.area)) best = { target, area };
    }
    return best?.target;
  };

  return {
    register(target) {
      targets.add(target);
      return () => {
        targets.delete(target);
      };
    },
    dispatch(event) {
      if (event.kind === 'press') {
        const target = hit(event, (h) => Boolean(h.onClick || h.drag !== undefined));
        dragging =
          target && target.handlers.current.drag !== undefined
            ? { value: target.handlers.current.drag, from: target }
            : null;
        target?.handlers.current.onClick?.();
        return;
      }
      const drop = dragging;
      dragging = null;
      if (!drop) return;
      const target = hit(event, (h) => Boolean(h.onDrop));
      if (target && target !== drop.from) target.handlers.current.onDrop?.(drop.value);
    },
  };
}

export const MouseContext = createContext<MouseRegistry | null>(null);

/** Feeds the reports from a `MouseStdin` into the registry until unmounted. */
export function useMouseSource(registry: MouseRegistry, source: EventEmitter | undefined): void {
  useEffect(() => {
    if (!source) return;
    const listener = (event: MouseEvent) => registry.dispatch(event);
    source.on('mouse', listener);
    return () => {
      source.off('mouse', listener);
    };
  }, [registry, source]);
}

/** Makes the box behind `ref` respond to the mouse while `active`. */
export function useMouse(ref: RefObject<DOMElement | null>, handlers: MouseHandlers, active = true): void {
  const registry = useContext(MouseContext);
  const latest = useRef(handlers);
  latest.current = handlers;
  useEffect(
    () => (registry && active ? registry.register({ ref, handlers: latest }) : undefined),
    [registry, ref, active],
  );
}
