import { describe, expect, it } from "vitest";
import { FORM_KEYS } from "../../keymap.js";
import { formHints, withExtraHints } from "./use-form-keys.js";

const OPTIONS = { navigation: false, submitLabel: "save", searchable: false, submitOnEnter: false };

describe("formHints", () => {
  it("gives the shared form keys for a plain save form", () => {
    expect(formHints(OPTIONS)).toBe(FORM_KEYS);
  });

  it("says that enter searches on a searchable field", () => {
    expect(formHints({ ...OPTIONS, searchable: true }).map((hint) => hint.key)).toEqual([
      "ctrl+s",
      "enter",
      "tab/↑/↓",
      "shift+tab",
    ]);
  });

  it("gives the next-tab key in a create host with tabs", () => {
    expect(formHints({ ...OPTIONS, navigation: true, submitLabel: "create" })).toEqual([
      { key: "ctrl+s", description: "create" },
      { key: "shift+tab", description: "next tab" },
      { key: "tab/↑/↓/enter", description: "field" },
    ]);
  });

  it("names the submit key and the enter key", () => {
    expect(formHints({ ...OPTIONS, submitLabel: "apply", submitOnEnter: true })[0]).toEqual({
      key: "enter/ctrl+s",
      description: "apply",
    });
  });
});

describe("withExtraHints", () => {
  it("puts the extra hints after the submit key", () => {
    const keys = [
      { key: "a", description: "1" },
      { key: "b", description: "2" },
    ];

    expect(withExtraHints(keys, [{ key: "x", description: "3" }]).map((hint) => hint.key)).toEqual(["a", "x", "b"]);
  });
});
