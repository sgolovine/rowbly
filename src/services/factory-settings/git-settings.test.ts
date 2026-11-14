import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMMIT_MESSAGE,
  formatAuthor,
  gitSync,
  hasGitInput,
  mergeGit,
  parseAuthor,
  validGit,
} from "./git-settings.js";

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
  it("validates the sync keys", () => {
    expect(validGit({ push: true, pull: false, syncIntervalSeconds: 60 })).toBe(true);
    expect(validGit({ syncIntervalSeconds: 86400, commitMessage: "chore: sync" })).toBe(true);
    for (const git of [{ push: "yes" }, { pull: 0 }, { syncIntervalSeconds: 59 }, { syncIntervalSeconds: 60.5 }]) {
      expect(validGit(git)).toBe(false);
    }
  });
  it("gives the sync defaults for absent keys", () => {
    expect(gitSync(undefined)).toEqual({ push: false, pull: false, syncIntervalSeconds: 300 });
    expect(gitSync({ pull: true, commitMessage: "x" })).toEqual({ push: false, pull: true, syncIntervalSeconds: 300 });
  });
  it("merges the sync keys and keeps the commit keys", () => {
    const current = { commitMessage: "old", authorName: "A", authorEmail: "a@example.com", push: true };
    expect(mergeGit(current, { gitPull: true, gitSyncInterval: 120 })).toEqual({
      ...current,
      pull: true,
      syncIntervalSeconds: 120,
    });
    expect(mergeGit(current, { gitPush: false })).toEqual({ ...current, push: false });
    expect(hasGitInput({ gitPush: false })).toBe(true);
    expect(hasGitInput({ gitSyncInterval: 60 })).toBe(true);
  });
  it("names the same default commit message as commit-project.mjs", async () => {
    const script = await readFile(
      new URL("../../../skills/factory/scripts/commit-project.mjs", import.meta.url),
      "utf8",
    );
    expect(script).toContain(`const DEFAULT_MESSAGE = "${DEFAULT_COMMIT_MESSAGE}";`);
  });
});
