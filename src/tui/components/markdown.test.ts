import { describe, expect, it } from "vitest";
import { loadMarkdownRenderer, markdownRenderer, plainMarkdownRows } from "./markdown.js";

const text = "# Title\n\nSome **bold** and `code`.\n\n- one\n- two\n";

describe("plainMarkdownRows", () => {
  it("drops the markdown syntax and keeps blank lines", () => {
    expect(plainMarkdownRows(text, 40)).toEqual(["Title", "", "Some bold and code.", "", "• one", "• two"]);
  });

  it("cuts lines into rows of at most the width", () => {
    expect(plainMarkdownRows("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("treats a width below 1 as 1", () => {
    expect(plainMarkdownRows("ab", 0)).toEqual(["a", "b"]);
  });
});

describe("loadMarkdownRenderer", () => {
  it("has no renderer until it loads, then one that lays out markdown", async () => {
    expect(markdownRenderer()).toBeUndefined();
    const render = await loadMarkdownRenderer();
    expect(markdownRenderer()).toBe(render);
    const rows = render(text, 40);
    expect(rows[0]).toContain("Title");
    expect(rows.join("\n")).toContain("Some bold and code.");
    expect(rows.join("\n")).not.toContain("**");
  });

  it("loads only once", async () => {
    expect(loadMarkdownRenderer()).toBe(loadMarkdownRenderer());
  });

  it("wraps rows wider than the width", async () => {
    const render = await loadMarkdownRenderer();
    expect(render("abcdefghijklmnopqrstuvwxyz", 10)).toEqual(["abcdefghij", "klmnopqrst", "uvwxyz"]);
  });
});
