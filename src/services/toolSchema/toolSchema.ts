import { z } from "zod";

/** Converts a Zod object schema to the JSON Schema that a Pi tool takes as `parameters`. */
export function toolParameters(schema: z.ZodObject): Record<string, unknown> {
  const { $schema: _, ...json } = z.toJSONSchema(schema, { io: "input" });

  return json;
}
