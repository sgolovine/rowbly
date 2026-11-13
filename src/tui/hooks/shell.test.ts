import { describe, expect, it } from "vitest";
import { createShellRegistry, uniqueKeys } from "./shell.js";

describe("createShellRegistry", () => {
  it("counts each capture until it is released, and releases one capture only one time", () => {
    const shell = createShellRegistry();
    const text = shell.capture({ text: true, escape: false });
    const both = shell.capture({ text: true, escape: true });

    expect(shell.captured()).toEqual({ text: true, escape: true });
    both();
    both();
    expect(shell.captured()).toEqual({ text: true, escape: false });
    text();
    expect(shell.captured()).toEqual({ text: false, escape: false });
  });

  it("tells which depth holds a dirty form", () => {
    const shell = createShellRegistry();

    shell.setDirty(1, "a", true);
    expect(shell.isDirty()).toBe(true);
    expect(shell.isDirty(1)).toBe(true);
    expect(shell.isDirty(0)).toBe(false);
    shell.setDirty(1, "a", false);
    expect(shell.isDirty()).toBe(false);
  });

  it("puts the lead hints first and shows each key one time", () => {
    const shell = createShellRegistry();

    shell.setHints(0, "screen", [
      { key: "n", description: "new" },
      { key: "esc", description: "back" },
    ]);
    shell.setHints(0, "form", [{ key: "esc", description: "cancel" }], true);
    expect(shell.hints(0).map((hint) => hint.description)).toEqual(["cancel", "new"]);
    shell.setHints(0, "form", null);
    expect(shell.hints(0).map((hint) => hint.description)).toEqual(["new", "back"]);
    shell.setHints(0, "screen", null);
    expect(shell.hints(0)).toEqual([]);
    expect(shell.hints(1)).toEqual([]);
  });

  it("keeps the place of a hint part that changes", () => {
    const shell = createShellRegistry();

    shell.setHints(0, "a", [{ key: "a", description: "first" }]);
    shell.setHints(0, "b", [{ key: "b", description: "second" }]);
    shell.setHints(0, "a", [{ key: "a", description: "changed" }]);
    expect(shell.hints(0).map((hint) => hint.description)).toEqual(["changed", "second"]);
  });
});

describe("uniqueKeys", () => {
  it("keeps the first hint of each key", () => {
    expect(
      uniqueKeys([
        { key: "a", description: "1" },
        { key: "a", description: "2" },
      ]),
    ).toEqual([{ key: "a", description: "1" }]);
  });
});
