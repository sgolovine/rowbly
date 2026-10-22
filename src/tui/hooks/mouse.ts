import type { EventEmitter } from 'node:events';
import { type DOMElement, measureElement } from 'ink';
import { createContext, type RefObject, useContext, useEffect, useRef } from 'react';
import type { MouseEvent } from '../mouse';

/** What a box does when clicked, and what it accepts when something is dragged onto it. */
export interface MouseHandlers {
  onClick?(): void;
  onEnter?(): void;
  onLeave?(): void;
  /**
   * Dragging starts on a press here and carries this value to the box it is released over. On such a
   * box `onClick` waits for the release: a press and release in the same cell is a click, and moving
   * to another cell while the button is held is a drag.
   */
  drag?: unknown;
  /** Dragged `value` released over this box, at cell `x`, `y`. */
  onDrop?(value: unknown, x: number, y: number): void;
  /** A drag carrying `value` has entered or moved over this drop target (one with `onDrop`), at cell `x`, `y`. */
  onDragOver?(value: unknown, x: number, y: number): void;
  /** The drag has left this drop target: moved off it, been dropped or ended elsewhere. */
  onDragLeave?(): void;
  /** A press here holds the box: each pointer move until the release reports the pointer's cell, e.g. to resize. */
  onPull?(x: number, y: number): void;
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
  let hovered: Target | undefined;
  let dragging: { value: unknown; from: Target; x: number; y: number; moved: boolean } | null = null;
  let pulling: Target | null = null;
  // The drop target under a drag that has moved, told on entering and leaving.
  let over: Target | undefined;

  const setOver = (next: Target | undefined) => {
    if (next === over) return;
    over?.handlers.current.onDragLeave?.();
    over = next;
  };

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
        if (hovered === target) {
          hovered = undefined;
          target.handlers.current.onLeave?.();
        }
        if (over === target) setOver(undefined);
        targets.delete(target);
      };
    },
    dispatch(event) {
      if (event.kind === 'move') {
        if (pulling) return pulling.handlers.current.onPull?.(event.x, event.y);
        if (dragging && (event.x !== dragging.x || event.y !== dragging.y)) dragging.moved = true;
        if (dragging?.moved) {
          setOver(hit(event, (h) => Boolean(h.onDrop)));
          over?.handlers.current.onDragOver?.(dragging.value, event.x, event.y);
        }
        const next = hit(event, (handlers) => Boolean(handlers.onEnter || handlers.onLeave));
        if (next !== hovered) {
          hovered?.handlers.current.onLeave?.();
          hovered = next;
          hovered?.handlers.current.onEnter?.();
        }
        return;
      }
      if (event.kind === 'press') {
        const target = hit(event, (h) => Boolean(h.onClick || h.drag !== undefined || h.onPull));
        pulling = target?.handlers.current.onPull ? target : null;
        if (pulling) return;
        if (target && target.handlers.current.drag !== undefined) {
          dragging = { value: target.handlers.current.drag, from: target, x: event.x, y: event.y, moved: false };
          return;
        }
        dragging = null;
        setOver(undefined);
        target?.handlers.current.onClick?.();
        return;
      }
      pulling = null;
      setOver(undefined);
      const drop = dragging;
      dragging = null;
      if (!drop) return;
      if (!drop.moved && event.x === drop.x && event.y === drop.y) {
        drop.from.handlers.current.onClick?.();
        return;
      }
      const target = hit(event, (h) => Boolean(h.onDrop));
      if (target && target !== drop.from) target.handlers.current.onDrop?.(drop.value, event.x, event.y);
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
