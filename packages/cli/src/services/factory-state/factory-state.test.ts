import { readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { useTestProject } from "../test-project/test-project.js";
import { readFactoryState, updateFactoryState } from "./factory-state.js";

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
  it("keeps the host of an attempt, and reads an attempt without a host, after a state update", async () => {
    const base = {
      story: "ROW-1",
      stage: "DEVELOP",
      status: "running" as const,
      startedAt: "2026-11-13T00:00:00.000Z",
    };
    const attempts = [
      { ...base, workerId: "w1", host: "builder" },
      { ...base, story: "ROW-2", workerId: "w2" },
    ];

    await updateFactoryState(project.paths.root, (state) => ({ ...state, attempts }));
    await updateFactoryState(project.paths.root, (state) => ({ ...state, custom: 1 }));

    const state = await readFactoryState(project.paths.root);

    expect(state.attempts.map((attempt) => attempt.host)).toEqual(["builder", undefined]);
  });
  it("preserves malformed files", async () => {
    await writeFile(project.paths.stateFile, "{");
    await expect(updateFactoryState(project.paths.root, (state) => state)).rejects.toThrow();
    expect(await readFile(project.paths.stateFile, "utf8")).toBe("{");
  });
});
