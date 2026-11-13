import type { EventEmitter } from "node:events";
import { type DOMElement, measureElement } from "ink";
import { createContext, type RefObject, useContext, useEffect } from "react";
import { Store, withMember, withoutMember } from "../../services/store/store.js";
import type { MouseEvent } from "../mouse.js";
import { useLatest } from "./refs.js";

/** Lines one notch of the mouse wheel scrolls. */
export const WHEEL_LINES = 3;

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
  /** A notch of the wheel over this box: `-1` up, `1` down. */
  onWheel?(direction: -1 | 1): void;
}

interface Target {
  readonly ref: RefObject<DOMElement | null>;
  readonly handlers: RefObject<MouseHandlers>;
  readonly clip: RefObject<DOMElement | null> | null;
}

/**
 * The clickable boxes on screen. A press goes to the smallest box under the pointer. A right click
 * (`menu`) ends a drag or pull in progress. A wheel notch goes to the smallest such box with `onWheel`.
 */
export interface MouseRegistry {
  register(target: Target): () => void;
  dispatch(event: MouseEvent): void;
}

/** A press on a box with a `drag` value, until the release. */
interface Drag {
  readonly value: unknown;
  readonly from: Target;
  readonly x: number;
  readonly y: number;
  readonly moved: boolean;
}

interface MouseState {
  readonly targets: ReadonlySet<Target>;
  readonly hovered: Target | undefined;
  readonly dragging: Drag | null;
  readonly pulling: Target | null;
  /** The drop target under a drag that has moved, told on entering and leaving. */
  readonly over: Target | undefined;
}

type MouseStore = Store<MouseState>;

type Wants = (handlers: MouseHandlers) => boolean;

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface Hit {
  readonly target: Target;
  readonly area: number;
}

/** What each kind of mouse event does to the registry. */
const DISPATCH: Readonly<Record<MouseEvent["kind"], (store: MouseStore, event: MouseEvent) => void>> = {
  wheelUp: dispatchWheel,
  wheelDown: dispatchWheel,
  menu: cancelGesture,
  move: dispatchMove,
  press: dispatchPress,
  release: dispatchRelease,
};

function contains(box: Box, event: MouseEvent): boolean {
  return event.x >= box.x && event.x < box.x + box.width && event.y >= box.y && event.y < box.y + box.height;
}

/** Whether the pointer is in the visible cells of the viewport that clips `target`. */
function insideClip(target: Target, event: MouseEvent): boolean {
  const viewport = target.clip?.current;

  if (!target.clip) {
    return true;
  }

  return viewport ? contains(measureElement(viewport), event) : false;
}

/** The area of `target` when the pointer is on it and it wants the event, or `0`. */
function hitArea(target: Target, event: MouseEvent, wants: Wants): number {
  const node = target.ref.current;
  const box = node ? measureElement(node) : undefined;
  const area = box ? box.width * box.height : 0;

  if (!box || area === 0 || !contains(box, event)) {
    return 0;
  }

  return insideClip(target, event) && wants(target.handlers.current) ? area : 0;
}

/** Keeps the first of the smallest boxes. */
function smallerHit(best: Hit | undefined, target: Target, area: number): Hit | undefined {
  return area > 0 && (!best || area < best.area) ? { target, area } : best;
}

/** The smallest box under the pointer that wants the event. */
function hit(store: MouseStore, event: MouseEvent, wants: Wants): Target | undefined {
  const best = [...store.current.targets].reduce<Hit | undefined>(
    (found, target) => smallerHit(found, target, hitArea(target, event, wants)),
    undefined,
  );

  return best?.target;
}

function setOver(store: MouseStore, next: Target | undefined): void {
  const { over } = store.current;

  if (next === over) {
    return;
  }

  over?.handlers.current.onDragLeave?.();
  store.update(() => ({ over: next }));
}

function registerTarget(store: MouseStore, target: Target): () => void {
  store.update((state) => ({ targets: withMember(state.targets, target) }));

  return () => unregisterTarget(store, target);
}

function unregisterTarget(store: MouseStore, target: Target): void {
  if (store.current.hovered === target) {
    store.update(() => ({ hovered: undefined }));
    target.handlers.current.onLeave?.();
  }

  if (store.current.over === target) {
    setOver(store, undefined);
  }

  store.update((state) => ({ targets: withoutMember(state.targets, target) }));
}

function dispatchWheel(store: MouseStore, event: MouseEvent): void {
  hit(store, event, (handlers) => Boolean(handlers.onWheel))?.handlers.current.onWheel?.(
    event.kind === "wheelUp" ? -1 : 1,
  );
}

/** A right click ends a drag or a pull. */
function cancelGesture(store: MouseStore): void {
  store.update(() => ({ pulling: null, dragging: null }));
  setOver(store, undefined);
}

function dispatchMove(store: MouseStore, event: MouseEvent): void {
  const { pulling } = store.current;

  if (pulling) {
    pulling.handlers.current.onPull?.(event.x, event.y);

    return;
  }

  dragOver(store, event);
  hover(store, event);
}

/** Tells the drop target under a drag that has moved. */
function dragOver(store: MouseStore, event: MouseEvent): void {
  const { dragging } = store.current;

  if (!dragging) {
    return;
  }

  if (event.x !== dragging.x || event.y !== dragging.y) {
    store.update(() => ({ dragging: { ...dragging, moved: true } }));
  }

  if (!store.current.dragging?.moved) {
    return;
  }

  setOver(
    store,
    hit(store, event, (handlers) => Boolean(handlers.onDrop)),
  );
  store.current.over?.handlers.current.onDragOver?.(dragging.value, event.x, event.y);
}

function hover(store: MouseStore, event: MouseEvent): void {
  const next = hit(store, event, (handlers) => Boolean(handlers.onEnter || handlers.onLeave));
  const { hovered } = store.current;

  if (next === hovered) {
    return;
  }

  hovered?.handlers.current.onLeave?.();
  store.update(() => ({ hovered: next }));
  next?.handlers.current.onEnter?.();
}

function dispatchPress(store: MouseStore, event: MouseEvent): void {
  const target = hit(store, event, (handlers) =>
    Boolean(handlers.onClick || handlers.drag !== undefined || handlers.onPull),
  );
  const pulling = target?.handlers.current.onPull ? target : null;

  store.update(() => ({ pulling }));

  if (pulling) {
    return;
  }

  if (target && target.handlers.current.drag !== undefined) {
    store.update(() => ({
      dragging: { value: target.handlers.current.drag, from: target, x: event.x, y: event.y, moved: false },
    }));

    return;
  }

  store.update(() => ({ dragging: null }));
  setOver(store, undefined);
  target?.handlers.current.onClick?.();
}

function dispatchRelease(store: MouseStore, event: MouseEvent): void {
  store.update(() => ({ pulling: null }));
  setOver(store, undefined);

  const drop = store.current.dragging;

  store.update(() => ({ dragging: null }));

  if (drop) {
    release(store, event, drop);
  }
}

/** A release in the cell of the press is a click. Elsewhere, it drops the value on the box under it. */
function release(store: MouseStore, event: MouseEvent, drop: Drag): void {
  if (!drop.moved && event.x === drop.x && event.y === drop.y) {
    drop.from.handlers.current.onClick?.();

    return;
  }

  const target = hit(store, event, (handlers) => Boolean(handlers.onDrop));

  if (target && target !== drop.from) {
    target.handlers.current.onDrop?.(drop.value, event.x, event.y);
  }
}

/** Makes the registry of the clickable boxes for one app. */
export function createMouseRegistry(): MouseRegistry {
  const store = new Store<MouseState>({
    targets: new Set(),
    hovered: undefined,
    dragging: null,
    pulling: null,
    over: undefined,
  });

  return {
    register: (target) => registerTarget(store, target),
    dispatch: (event) => DISPATCH[event.kind](store, event),
  };
}

export const MouseContext = createContext<MouseRegistry | null>(null);

/** Restricts descendant mouse targets to the visible cells of a borderless viewport. */
const MouseClipContext = createContext<RefObject<DOMElement | null> | null>(null);

/** Gives one listener for the `on` and the `off` of a mouse source. */
function mouseListener(registry: MouseRegistry): (event: MouseEvent) => void {
  return (event) => registry.dispatch(event);
}

/** Feeds the reports from a `MouseStdin` into the registry until unmounted. */
export function useMouseSource(registry: MouseRegistry, source: EventEmitter | undefined): void {
  useEffect(() => {
    if (!source) {
      return;
    }

    const listener = mouseListener(registry);

    source.on("mouse", listener);

    return () => {
      source.off("mouse", listener);
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
