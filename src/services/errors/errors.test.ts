import { describe, expect, it } from "vitest";
import { ConflictError, NotFoundError, RowblyError, ValidationError } from "./errors.js";

describe("errors", () => {
  it("sets the code, name, hint and details", () => {
    const error = new ValidationError("bad", { hint: "fix it", details: { issues: [] } });
    expect(error).toBeInstanceOf(RowblyError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("VALIDATION");
    expect(error.name).toBe("ValidationError");
    expect(error.message).toBe("bad");
    expect(error.hint).toBe("fix it");
    expect(error.details).toEqual({ issues: [] });
  });

  it("defaults details to an empty object and hint to undefined", () => {
    const error = new NotFoundError("missing");
    expect(error.code).toBe("NOT_FOUND");
    expect(error.details).toEqual({});
    expect(error.hint).toBeUndefined();
  });

  it("keeps the cause", () => {
    const cause = new Error("root");
    expect(new ConflictError("clash", { cause }).cause).toBe(cause);
    expect(new ConflictError("clash").code).toBe("CONFLICT");
  });
});
