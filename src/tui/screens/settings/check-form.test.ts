import { describe, expect, it } from "vitest";
import { checkChange, checkFields, checkValues } from "./check-form.js";

describe("check form", () => {
  it("has the key only for a new check", () => {
    expect(checkFields(true).map((field) => field.name)[0]).toBe("key");
    expect(checkFields(false).map((field) => field.name)).not.toContain("key");
  });

  it("gives the values of a check, and a change that removes the empty values", () => {
    const check = {
      key: "test",
      label: "test",
      command: "pnpm test",
      memoryMb: 1024,
      timeoutMinutes: 30,
      block: ["a", "b"],
    };

    expect(checkValues(check)).toMatchObject({ label: "", block: "a\nb", memoryMb: 1024 });
    expect(
      checkChange({ label: " ", command: " pnpm test ", narrowCommand: "", memoryMb: null, block: "a\n\n b " }),
    ).toEqual({
      label: null,
      command: "pnpm test",
      narrowCommand: null,
      memoryMb: null,
      timeoutMinutes: null,
      block: ["a", "b"],
    });
  });
});
