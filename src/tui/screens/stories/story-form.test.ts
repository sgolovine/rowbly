import { describe, expect, it } from "vitest";
import type { CustomField } from "../../../services/config/config.js";
import { customFieldInput, customFormValue } from "./story-form.js";

const fields: CustomField[] = [
  { key: "points", label: "Points", type: "number" },
  { key: "size", label: "Size", type: "select", options: ["S", "M"] },
  { key: "url", label: "URL", type: "url" },
];

describe("customFieldInput", () => {
  it("gives null for an empty or unset value, and the text otherwise", () => {
    expect(customFieldInput(fields, { points: "3", size: "—", url: "" })).toEqual({
      points: "3",
      size: null,
      url: null,
    });
  });
});

describe("customFormValue", () => {
  it("gives the unset choice to a select field, and empty text to a text field", () => {
    expect(customFormValue(fields[1] as CustomField, null)).toBe("—");
    expect(customFormValue(fields[0] as CustomField, null)).toBe("");
    expect(customFormValue(fields[0] as CustomField, 3)).toBe("3");
  });
});
