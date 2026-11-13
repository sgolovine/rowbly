import { expect, it } from "vitest";
import { createResultTool } from "./factory-worker.js";

it("accepts an identical result once and rejects conflicting duplicate results", async () => {
  let calls = 0;
  const tool = createResultTool(async () => {
    calls++;
  });
  const result = { outcome: "complete", summary: "Done", blockers: [], problems: [] };
  await tool.execute("a", result);
  await tool.execute("b", result);
  expect(calls).toBe(1);
  await expect(tool.execute("c", { ...result, summary: "Different" })).rejects.toThrow("different values");
});
