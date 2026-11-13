import { readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { useTestProject } from "../testProject/testProject.js";
import { readFactoryState, updateFactoryState } from "./factoryState.js";

describe("factory state wrapper", () => {
  const project = useTestProject();
  it("serializes transactions and preserves unknown v1 keys", async () => {
    await Promise.all(
      Array.from({ length: 8 }, () =>
        updateFactoryState(project.paths.root, (state) => ({ ...state, custom: Number(state.custom ?? 0) + 1 })),
      ),
    );
    expect((await readFactoryState(project.paths.root)).custom).toBe(8);
  });
  it("preserves malformed files", async () => {
    await writeFile(project.paths.stateFile, "{");
    await expect(updateFactoryState(project.paths.root, (state) => state)).rejects.toThrow();
    expect(await readFile(project.paths.stateFile, "utf8")).toBe("{");
  });
});
