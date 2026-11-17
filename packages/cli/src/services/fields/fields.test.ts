import { describe, expect, it } from "vitest";
import type { CustomField, CustomFieldType } from "../config/config.js";
import { coerceFieldValue, fieldValueError } from "./fields.js";

function field(type: CustomFieldType, options?: string[]): CustomField {
  return { key: "f", label: "F", type, ...(options && { options }) };
}

describe("fieldValueError", () => {
  it("accepts null for every type", () => {
    for (const type of ["string", "number", "boolean", "url", "date"] as const) {
      expect(fieldValueError(field(type), null)).toBeUndefined();
    }
  });

  it.each([
    ["string", "text", 1],
    ["number", 1.5, "1"],
    ["boolean", false, "false"],
    ["url", "https://example.com", "not a url"],
    ["date", "2024-02-29", "2023-02-29"],
  ] as const)("checks a %s value", (type, valid, invalid) => {
    expect(fieldValueError(field(type), valid)).toBeUndefined();
    expect(fieldValueError(field(type), invalid)).toMatch(/^F must be/);
  });

  it("rejects a number that is not finite", () => {
    expect(fieldValueError(field("number"), Number.NaN)).toBeDefined();
    expect(fieldValueError(field("number"), Number.POSITIVE_INFINITY)).toBeDefined();
  });

  it("accepts only the options of a select field", () => {
    const select = field("select", ["low", "high"]);
    expect(fieldValueError(select, "low")).toBeUndefined();
    expect(fieldValueError(select, "mid")).toBe("F must be one of low, high");
  });
});

describe("coerceFieldValue", () => {
  it("turns undefined and empty text into null", () => {
    expect(coerceFieldValue(field("number"), undefined)).toEqual({ ok: true, value: null });
    expect(coerceFieldValue(field("string"), "  ")).toEqual({ ok: true, value: null });
  });

  it("parses numbers", () => {
    expect(coerceFieldValue(field("number"), " 42 ")).toEqual({ ok: true, value: 42 });
    expect(coerceFieldValue(field("number"), "abc")).toEqual({ ok: false, error: "F must be a number" });
  });

  it.each([
    ["yes", true],
    ["Y", true],
    ["1", true],
    ["true", true],
    ["no", false],
    ["0", false],
    ["FALSE", false],
  ])("parses the boolean %s", (text, value) => {
    expect(coerceFieldValue(field("boolean"), text)).toEqual({ ok: true, value });
  });

  it("rejects an unknown boolean word", () => {
    expect(coerceFieldValue(field("boolean"), "maybe").ok).toBe(false);
  });

  it("keeps the text of a string field untrimmed", () => {
    expect(coerceFieldValue(field("string"), " a ")).toEqual({ ok: true, value: " a " });
  });

  it("turns a number or boolean into text for a string field", () => {
    expect(coerceFieldValue(field("string"), 3)).toEqual({ ok: true, value: "3" });
    expect(coerceFieldValue(field("string"), true)).toEqual({ ok: true, value: "true" });
  });

  it("trims dates, URLs and select values", () => {
    expect(coerceFieldValue(field("date"), " 2024-01-02 ")).toEqual({ ok: true, value: "2024-01-02" });
    expect(coerceFieldValue(field("select", ["a"]), " a ")).toEqual({ ok: true, value: "a" });
  });
});
