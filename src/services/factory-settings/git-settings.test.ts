import { describe, expect, it } from "vitest";
import { formatAuthor, hasGitInput, mergeGit, parseAuthor, validGit } from "./git-settings.js";

describe("gitSettings", () => {
  it("accepts non-empty strings and an author with both name and email", () => {
    expect(validGit({})).toBe(true);
    expect(validGit({ commitMessage: "chore: sync" })).toBe(true);
    expect(validGit({ authorName: "Bot", authorEmail: "bot@example.com" })).toBe(true);
  });
  it("rejects empty or non-string values and a partial author", () => {
    expect(validGit(null)).toBe(false);
    expect(validGit("git")).toBe(false);
    expect(validGit([])).toBe(false);
    expect(validGit({ commitMessage: "" })).toBe(false);
    expect(validGit({ commitMessage: "  " })).toBe(false);
    expect(validGit({ authorName: "Bot", authorEmail: 5 })).toBe(false);
    expect(validGit({ authorName: "Bot" })).toBe(false);
    expect(validGit({ authorEmail: "bot@example.com" })).toBe(false);
  });
  it("parses and formats a Name <email> identity", () => {
    expect(parseAuthor(" Rowbly Bot <bot@example.com> ")).toEqual({
      authorName: "Rowbly Bot",
      authorEmail: "bot@example.com",
    });
    expect(formatAuthor({ authorName: "Rowbly Bot", authorEmail: "bot@example.com" })).toBe(
      "Rowbly Bot <bot@example.com>",
    );
    expect(formatAuthor({ commitMessage: "x" })).toBeUndefined();
    expect(formatAuthor(undefined)).toBeUndefined();
  });
  it("rejects an identity that is not in the Name <email> form", () => {
    for (const value of ["bot@example.com", "<bot@example.com>", "Bot <>", "Bot <a b>", "Bot <x> extra"]) {
      expect(() => parseAuthor(value)).toThrow("Name <email>");
    }
  });
  it("merges, keeps and clears values", () => {
    const current = { commitMessage: "old", authorName: "A", authorEmail: "a@example.com", other: 1 } as never;
    expect(mergeGit(undefined, { commitMessage: "new" })).toEqual({ commitMessage: "new" });
    expect(mergeGit(current, { commitAuthor: "B <b@example.com>" })).toEqual({
      other: 1,
      commitMessage: "old",
      authorName: "B",
      authorEmail: "b@example.com",
    });
    expect(mergeGit(current, { commitMessage: "" })).toEqual({
      other: 1,
      authorName: "A",
      authorEmail: "a@example.com",
    });
    expect(mergeGit({ commitMessage: "old" }, { commitMessage: "", commitAuthor: "" })).toBeUndefined();
  });
  it("tells if the input has Git values", () => {
    expect(hasGitInput({})).toBe(false);
    expect(hasGitInput({ commitMessage: "" })).toBe(true);
    expect(hasGitInput({ commitAuthor: "A <a@example.com>" })).toBe(true);
  });
});
