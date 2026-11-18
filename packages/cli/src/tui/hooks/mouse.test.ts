import type { DOMElement } from "ink";
import { describe, expect, it, vi } from "vitest";
import { createMouseRegistry, type MouseHandlers } from "./mouse.js";

interface FakeBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

vi.mock("ink", () => ({
  measureElement: (node: { box: FakeBox }) => node.box,
}));

/** Registers a box with `handlers` at `box` in `registry`. */
function target(registry: ReturnType<typeof createMouseRegistry>, box: FakeBox, handlers: MouseHandlers) {
  const node = { box } as unknown as DOMElement;

  registry.register({ ref: { current: node }, handlers: { current: handlers }, clip: null });
}

describe("createMouseRegistry menu events", () => {
  it("sends a right click to the smallest box under the pointer that has onMenu", () => {
    const registry = createMouseRegistry();
    const outer = vi.fn();
    const inner = vi.fn();
    const click = vi.fn();

    target(registry, { x: 0, y: 0, width: 20, height: 10 }, { onMenu: outer });
    target(registry, { x: 2, y: 2, width: 5, height: 1 }, { onMenu: inner });
    // A smaller box without onMenu does not take the right click.
    target(registry, { x: 3, y: 2, width: 1, height: 1 }, { onClick: click });

    registry.dispatch({ kind: "menu", x: 3, y: 2 });

    expect(inner).toHaveBeenCalledWith(3, 2);
    expect(outer).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();

    registry.dispatch({ kind: "menu", x: 15, y: 8 });

    expect(outer).toHaveBeenCalledWith(15, 8);
  });

  it("does nothing when no box under the pointer has onMenu", () => {
    const registry = createMouseRegistry();
    const onMenu = vi.fn();

    target(registry, { x: 0, y: 0, width: 5, height: 1 }, { onMenu });
    registry.dispatch({ kind: "menu", x: 10, y: 10 });

    expect(onMenu).not.toHaveBeenCalled();
  });

  it("only ends a drag in progress", () => {
    const registry = createMouseRegistry();
    const onMenu = vi.fn();
    const onDrop = vi.fn();
    const onDragLeave = vi.fn();

    target(registry, { x: 0, y: 0, width: 10, height: 1 }, { drag: "story", onMenu });
    target(registry, { x: 0, y: 1, width: 10, height: 1 }, { onDrop, onDragLeave, onMenu });

    registry.dispatch({ kind: "press", x: 1, y: 0 });
    registry.dispatch({ kind: "move", x: 1, y: 1 });
    registry.dispatch({ kind: "menu", x: 1, y: 1 });

    expect(onMenu).not.toHaveBeenCalled();
    expect(onDragLeave).toHaveBeenCalled();

    registry.dispatch({ kind: "release", x: 1, y: 1 });

    expect(onDrop).not.toHaveBeenCalled();

    // The next right click, without a drag, goes to the box.
    registry.dispatch({ kind: "menu", x: 1, y: 1 });

    expect(onMenu).toHaveBeenCalledWith(1, 1);
  });

  it("only ends a pull in progress", () => {
    const registry = createMouseRegistry();
    const onPull = vi.fn();
    const onMenu = vi.fn();

    target(registry, { x: 0, y: 0, width: 1, height: 5 }, { onPull, onMenu });

    registry.dispatch({ kind: "press", x: 0, y: 2 });
    registry.dispatch({ kind: "menu", x: 0, y: 2 });

    expect(onMenu).not.toHaveBeenCalled();

    registry.dispatch({ kind: "move", x: 4, y: 2 });

    expect(onPull).not.toHaveBeenCalled();
  });
});
