import { describe, expect, it } from "vitest";
import { fuzzySearch } from "./fuzzySearch.js";

const byText = (a: string, b: string) => a.localeCompare(b);
const search = (entries: string[], query: string) => fuzzySearch(entries, query, (e) => [e], byText);

describe("fuzzySearch", () => {
  it("keeps the input order, in a copy, for an empty query", () => {
    const entries = ["b", "a", "c"];
    const result = search(entries, "  ");
    expect(result).toEqual(["b", "a", "c"]);
    expect(result).not.toBe(entries);
  });

  it("ranks exact, then contiguous, then subsequence matches, and drops the rest", () => {
    expect(search(["axbxc", "xabc", "zzz", "abc"], "abc")).toEqual(["abc", "xabc", "axbxc"]);
  });

  it("ignores case", () => {
    expect(search(["Done", "Backlog"], "DONE")).toEqual(["Done"]);
  });

  it("needs every term to match, each in any one field", () => {
    const entries = [
      { id: "a", fields: ["ab", "cd"] },
      { id: "b", fields: ["ab", "xy"] },
    ];
    const run = (query: string) =>
      fuzzySearch(
        entries,
        query,
        (e) => e.fields,
        (a, b) => a.id.localeCompare(b.id),
      ).map((e) => e.id);
    expect(run("ab cd")).toEqual(["a"]);
    // A subsequence does not run across two fields.
    expect(run("ac")).toEqual([]);
  });

  it("breaks ties with compare", () => {
    expect(search(["bx", "ax"], "x")).toEqual(["ax", "bx"]);
  });
});
