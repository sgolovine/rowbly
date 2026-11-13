import { describe, expect, it } from "vitest";
import { newerPage, olderPage } from "./session-branch.js";
import type { EntryIndex } from "./session-types.js";

const bounds = { limit: 2, maxBytes: 100 };

function chain(...links: [string, string | null, number?][]): ReadonlyMap<string, EntryIndex> {
  return new Map(
    links.map(([id, parentId, length = 10]) => [id, { id, parentId, type: "message", offset: 0, length }]),
  );
}

const ids = (page: { selected: readonly EntryIndex[] }) => page.selected.map((meta) => meta.id);

describe("session branch", () => {
  const entries = chain(["a", null], ["b", "a"], ["c", "b"], ["d", "c"], ["x", "b"]);

  it("pages older entries from the leaf and gives the next cursor", () => {
    const latest = olderPage(entries, "d", bounds);
    expect(ids(latest)).toEqual(["c", "d"]);
    expect(latest).toMatchObject({ bytes: 20, nextBefore: "c" });

    const oldest = olderPage(entries, "b", bounds);
    expect(ids(oldest)).toEqual(["a", "b"]);
    expect(oldest.nextBefore).toBeNull();
  });

  it("pages newer entries on the active branch only", () => {
    const first = newerPage(entries, "d", "a", bounds);
    expect(ids(first)).toEqual(["b", "c"]);
    expect(first).toMatchObject({ nextBefore: "b", nextAfter: "c" });

    const last = newerPage(entries, "d", "c", bounds);
    expect(ids(last)).toEqual(["d"]);
    expect(last.nextAfter).toBeNull();
    expect(() => newerPage(entries, "d", "x", bounds)).toThrow("no longer available");
  });

  it("stops a page at the byte limit and at an oversized entry", () => {
    const sized = chain(["a", null, 60], ["b", "a", 60], ["c", "b", 500]);
    expect(ids(olderPage(sized, "b", { limit: 5, maxBytes: 100 }))).toEqual(["b"]);
    expect(olderPage(sized, "c", { limit: 5, maxBytes: 100 })).toMatchObject({ bytes: 100, nextBefore: "c" });
    expect(ids(newerPage(sized, "c", "a", { limit: 5, maxBytes: 100 }))).toEqual(["b"]);
  });

  it("reports a cycle and a missing parent", () => {
    const cycle = chain(["a", "b"], ["b", "a"], ["c", null]);
    expect(() => olderPage(cycle, "a", { limit: 5, maxBytes: 100 })).toThrow("cycle");
    expect(() => newerPage(cycle, "a", "c", bounds)).toThrow("cycle");

    const broken = chain(["a", "ghost"], ["c", null]);
    expect(() => olderPage(broken, "a", { limit: 5, maxBytes: 100 })).toThrow("parent is missing");
    expect(() => newerPage(broken, "a", "c", bounds)).toThrow("parent is missing");
  });

  it("walks a long branch without a deep stack", () => {
    const long = chain(
      ...Array.from({ length: 50_000 }, (_, i): [string, string | null] => [`n${i}`, i ? `n${i - 1}` : null]),
    );
    expect(ids(newerPage(long, "n49999", "n0", bounds))).toEqual(["n1", "n2"]);
  });
});
