import { describe, expect, it } from "vitest";
import { ValidationError } from "../../../services/errors/errors.js";
import {
  type FormField,
  fillsFrom,
  initialFilled,
  isDirty,
  issuesByField,
  parseAll,
  rawValues,
} from "./form-values.js";

const FIELDS: FormField[] = [
  { name: "title", label: "Title", kind: "text", required: true },
  { name: "points", label: "Points", kind: "number" },
  { name: "due", label: "Due", kind: "date" },
  { name: "done", label: "Done", kind: "boolean" },
  { name: "stage", label: "Stage", kind: "select", options: ["A", "B"] },
  { name: "tags", label: "Tags", kind: "multiselect", options: ["x"] },
];

const SLUG: FormField[] = [
  { name: "name", label: "Name", kind: "text" },
  { name: "key", label: "Key", kind: "text", fillFrom: { field: "name", format: (text) => text.toUpperCase() } },
];

describe("rawValues", () => {
  it("gives each kind its edited form", () => {
    expect(rawValues(FIELDS, { points: 3, done: "yes", stage: 1, tags: null })).toEqual({
      title: "",
      points: "3",
      due: "",
      done: false,
      stage: null,
      tags: [],
    });
  });
});

describe("isDirty", () => {
  it("compares each field with its starting value", () => {
    const initial = rawValues(FIELDS, {});

    expect(isDirty(FIELDS, initial, initial)).toBe(false);
    expect(isDirty(FIELDS, { ...initial, tags: ["x"] }, initial)).toBe(true);
  });
});

describe("parseAll", () => {
  it("gives the values of the valid fields and the error of each invalid field", () => {
    const { parsed, found } = parseAll(FIELDS, {
      ...rawValues(FIELDS, {}),
      points: "abc",
      due: "2026-02-30x",
    });

    expect(found).toEqual({ title: "required", points: "must be a number", due: "must be a date (YYYY-MM-DD)" });
    expect(parsed).toEqual({ done: false, stage: null, tags: [] });
  });

  it("gives null for an empty number or date", () => {
    expect(parseAll(FIELDS, { ...rawValues(FIELDS, {}), title: "t", points: "" }).parsed).toMatchObject({
      points: null,
      due: null,
    });
  });
});

describe("issuesByField", () => {
  it("shows the first issue of each field, and the others below the form", () => {
    const err = new ValidationError("bad", {
      details: {
        issues: [
          { path: ["title"], message: "too short" },
          { path: ["title"], message: "second" },
          { path: ["other"], message: "elsewhere" },
          { path: [] },
        ],
      },
    });

    expect(issuesByField(err, FIELDS)).toEqual({ byField: { title: "too short" }, rest: ["elsewhere", "invalid"] });
  });

  it("shows the error message when there are no issues", () => {
    expect(issuesByField(new ValidationError("bad"), FIELDS)).toEqual({ byField: {}, rest: ["bad"] });
  });
});

describe("fillFrom", () => {
  it("counts a starting value that fillFrom would give as filled", () => {
    expect(initialFilled(SLUG, { name: "ab", key: "AB" })).toEqual({ key: "AB" });
    expect(initialFilled(SLUG, { name: "ab", key: "XY" })).toEqual({});
  });

  it("fills an empty field or a field that still holds the last fill", () => {
    expect(fillsFrom(SLUG, { name: " ab ", key: "" }, {}, "name")).toEqual({ key: "AB" });
    expect(fillsFrom(SLUG, { name: "abc", key: "AB" }, { key: "AB" }, "name")).toEqual({ key: "ABC" });
    expect(fillsFrom(SLUG, { name: "abc", key: "typed" }, { key: "AB" }, "name")).toEqual({});
    expect(fillsFrom(SLUG, { name: "  ", key: "" }, {}, "name")).toEqual({});
    expect(fillsFrom(SLUG, { name: "ab", key: "" }, {}, undefined)).toEqual({});
  });
});
