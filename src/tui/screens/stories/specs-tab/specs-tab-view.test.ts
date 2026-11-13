import type { Key } from "ink";
import { describe, expect, it } from "vitest";
import type { Spec } from "../../../../services/spec/spec.js";
import { editorSize, listKeyMode, specsHints } from "./specs-tab-view.js";

const spec: Spec = { slug: "api", title: "API", stories: ["ROW-01"], body: "", path: "/p/api.md" };
const noKey = {} as Key;

describe("specsHints", () => {
  it("gives no keys while another region has the keys", () => {
    expect(specsHints({ keysOwn: false, editing: false, count: 1, current: spec })).toEqual([]);
  });

  it("gives the keys of the list, with the spec keys only for a selected spec", () => {
    expect(specsHints({ keysOwn: true, editing: false, count: 1, current: spec }).map((hint) => hint.key)).toEqual([
      "↑/↓",
      "enter/tab",
      "n",
      "r",
      "d",
    ]);
    expect(specsHints({ keysOwn: true, editing: false, count: 0, current: undefined }).map((hint) => hint.key)).toEqual(
      ["n"],
    );
  });

  it("gives the keys of the editor", () => {
    expect(specsHints({ keysOwn: true, editing: true, count: 1, current: spec }).map((hint) => hint.key)).toEqual([
      "ctrl+s",
      "ctrl+f",
      "tab",
      "esc",
    ]);
  });
});

describe("editorSize", () => {
  it("fits the editor next to the list, and uses ten rows without a layout height", () => {
    expect(editorSize({ width: 100, height: undefined })).toEqual({ width: 100 - 26 - 1 - 4, rows: 10 });
    expect(editorSize({ width: 30, height: 4 })).toEqual({ width: 20, rows: 3 });
  });
});

describe("listKeyMode", () => {
  it("creates with n, also without a spec, and ignores ctrl keys", () => {
    expect(listKeyMode(undefined, "n", noKey)).toEqual({ kind: "new" });
    expect(listKeyMode(spec, "n", { ...noKey, ctrl: true })).toBeUndefined();
  });

  it("edits, renames and removes the selected spec", () => {
    expect(listKeyMode(spec, "", { ...noKey, return: true })).toEqual({ kind: "edit" });
    expect(listKeyMode(spec, "", { ...noKey, tab: true, shift: true })).toBeUndefined();
    expect(listKeyMode(spec, "r", noKey)).toEqual({ kind: "rename", spec });
    expect(listKeyMode(spec, "d", noKey)).toEqual({ kind: "remove", spec });
    expect(listKeyMode(undefined, "d", noKey)).toBeUndefined();
  });
});
