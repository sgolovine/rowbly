import { expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-coding-agent", () => {
  throw new Error("Pi loaded during command registration");
});

it("does not load Pi for help or command registration", async () => {
  const { createProgram } = await import("../../commands/testCli/testCli.js");
  expect(createProgram().helpInformation()).toContain("Usage:");
  await expect(import("./piRuntime.js")).resolves.toHaveProperty("loadPi");
});
