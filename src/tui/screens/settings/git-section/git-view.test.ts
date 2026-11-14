import { describe, expect, it } from "vitest";
import { gitForm, gitHints, gitTexts } from "./git-view.js";

describe("gitTexts", () => {
  it("shows no value before the settings load", () => {
    expect(gitTexts(undefined)).toEqual({ author: "—", message: "—", push: "—", pull: "—", interval: "—" });
  });

  it("shows the defaults without a git section", () => {
    expect(gitTexts({ maxWorkers: 4 })).toEqual({
      author: "Git config identity",
      message: "chore(rowbly): record project changes after scan",
      push: "off",
      pull: "off",
      interval: "300 seconds",
    });
  });

  it("shows the values of the git section", () => {
    const git = {
      authorName: "Bot",
      authorEmail: "bot@example.com",
      commitMessage: "chore: x",
      push: true,
      pull: true,
    };
    expect(gitTexts({ maxWorkers: 4, git: { ...git, syncIntervalSeconds: 60 } })).toEqual({
      author: "Bot <bot@example.com>",
      message: "chore: x",
      push: "on",
      pull: "on",
      interval: "60 seconds",
    });
  });
});

describe("gitForm", () => {
  it("starts each form with the current value, or empty text and the default interval", () => {
    const settings = {
      maxWorkers: 4,
      git: { authorName: "Bot", authorEmail: "b@x.io", commitMessage: "m", syncIntervalSeconds: 90 },
    };
    expect(gitForm("author", settings)).toMatchObject({
      field: { name: "author", kind: "text" },
      initial: "Bot <b@x.io>",
    });
    expect(gitForm("message", settings)).toMatchObject({ field: { name: "message" }, initial: "m" });
    expect(gitForm("interval", settings)).toMatchObject({ field: { name: "interval", kind: "number" }, initial: 90 });
    expect(gitForm("author", undefined).initial).toBe("");
    expect(gitForm("message", undefined).initial).toBe("");
    expect(gitForm("interval", undefined).initial).toBe(300);
    expect(gitForm("interval", undefined).note).toContain("60 to 86400");
  });
});

describe("gitHints", () => {
  it("names the five keys only while the section has the keys", () => {
    expect(gitHints(true).map((hint) => `${hint.key} ${hint.description}`)).toEqual([
      "a author",
      "m message",
      "p toggle push",
      "u toggle pull",
      "i interval",
    ]);
    expect(gitHints(false)).toEqual([]);
  });
});
