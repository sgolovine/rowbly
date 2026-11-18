import { describe, expect, it } from "vitest";
import { normalizeRepoUrl, sameRepository } from "./repo-url.js";

describe("repo-url", () => {
  it.each([
    ["git@github.com:o/r.git", "github.com/o/r"],
    ["ssh://git@github.com/o/r", "github.com/o/r"],
    ["ssh://git@github.com:22/o/r.git/", "github.com/o/r"],
    ["https://github.com/o/r.git", "github.com/o/r"],
    ["https://user@GitHub.com/O/R/", "github.com/o/r"],
    ["/srv/git/r.git", "srv/git/r"],
  ])("normalizes %s", (url, key) => {
    expect(normalizeRepoUrl(url)).toBe(key);
  });

  it.each([
    ["git@github.com:o/r.git", "ssh://git@github.com/o/r"],
    ["git@github.com:o/r.git", "https://github.com/o/r.git"],
    ["ssh://git@github.com/o/r", "https://github.com/o/r.git"],
  ])("gives the same repository for %s and %s", (a, b) => {
    expect(sameRepository(a, b)).toBe(true);
  });

  it.each([
    ["https://github.com/o/r.git", "https://github.com/o/other.git"],
    ["https://github.com/o/r.git", "https://gitlab.com/o/r.git"],
    ["git@github.com:o/r.git", "git@gitlab.com:o/r.git"],
  ])("gives a different repository for %s and %s", (a, b) => {
    expect(sameRepository(a, b)).toBe(false);
  });
});
