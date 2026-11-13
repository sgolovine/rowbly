import { describe, expect, it } from "vitest";
import { Store, withEntry, withMember, withoutEntries, withoutEntry, withoutMember } from "./store.js";

describe("Store", () => {
  it("gives a frozen copy of the initial value", () => {
    const initial = { count: 1 };
    const store = new Store(initial);

    expect(store.current).toEqual({ count: 1 });
    expect(store.current).not.toBe(initial);
    expect(Object.isFrozen(store.current)).toBe(true);
  });

  it("merges an update into a new frozen value", () => {
    const store = new Store({ count: 1, name: "a" });
    const before = store.current;

    const after = store.update((current) => ({ count: current.count + 1 }));

    expect(after).toEqual({ count: 2, name: "a" });
    expect(store.current).toBe(after);
    expect(before).toEqual({ count: 1, name: "a" });
    expect(Object.isFrozen(after)).toBe(true);
  });
});

describe("map helpers", () => {
  const source: ReadonlyMap<string, number> = new Map([
    ["a", 1],
    ["b", 2],
  ]);

  it("sets an entry in a new map", () => {
    expect([...withEntry(source, "c", 3)]).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
    expect(withEntry(source, "a", 9).get("a")).toBe(9);
    expect(source.get("a")).toBe(1);
  });

  it("removes an entry in a new map", () => {
    expect([...withoutEntry(source, "a")]).toEqual([["b", 2]]);
    expect(source.size).toBe(2);
  });

  it("removes the entries that match in a new map", () => {
    expect([...withoutEntries(source, (value) => value > 1)]).toEqual([["a", 1]]);
    expect(source.size).toBe(2);
  });
});

describe("set helpers", () => {
  const source: ReadonlySet<string> = new Set(["a", "b"]);

  it("adds a member in a new set", () => {
    expect([...withMember(source, "c")]).toEqual(["a", "b", "c"]);
    expect([...withMember(source, "a")]).toEqual(["a", "b"]);
    expect(source.size).toBe(2);
  });

  it("removes a member in a new set", () => {
    expect([...withoutMember(source, "a")]).toEqual(["b"]);
    expect([...withoutMember(source, "z")]).toEqual(["a", "b"]);
    expect(source.size).toBe(2);
  });
});
