import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toolParameters } from "./toolSchema.js";

describe("toolParameters", () => {
  it("gives a JSON Schema without the $schema key", () => {
    const json = toolParameters(
      z.object({
        name: z.string().max(10),
        count: z.int().min(1).optional(),
        mode: z.enum(["a", "b"]),
      }),
    );

    expect(json).toEqual({
      type: "object",
      properties: {
        name: { type: "string", maxLength: 10 },
        count: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
        mode: { type: "string", enum: ["a", "b"] },
      },
      required: ["name", "mode"],
    });
  });

  it("does not reject extra properties", () => {
    expect(toolParameters(z.object({}))).not.toHaveProperty("additionalProperties", false);
  });
});
