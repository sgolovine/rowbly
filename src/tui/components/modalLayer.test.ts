import { describe, expect, it, vi } from "vitest";
import { createLayerHost } from "./modalLayer.js";

describe("createLayerHost", () => {
  it("keeps the layers in the order they opened, and replaces a layer in place", () => {
    const host = createLayerHost();
    host.show("a", "A");
    host.show("b", "B");
    host.show("a", "A2");
    expect([...host.layers()]).toEqual([
      ["a", "A2"],
      ["b", "B"],
    ]);
  });

  it("gives a new snapshot on each change and the same one between changes", () => {
    const host = createLayerHost();
    const empty = host.layers();
    expect(host.layers()).toBe(empty);
    host.show("a", "A");
    const one = host.layers();
    expect(one).not.toBe(empty);
    expect(empty.size).toBe(0);
    host.hide("a");
    expect(host.layers().size).toBe(0);
    expect(one.size).toBe(1);
  });

  it("tells the listeners on a change, but not on a hide of an unknown id or after unsubscribe", () => {
    const host = createLayerHost();
    const listener = vi.fn();
    const unsubscribe = host.subscribe(listener);
    host.show("a", "A");
    host.hide("missing");
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    host.hide("a");
    expect(listener).toHaveBeenCalledOnce();
  });
});
