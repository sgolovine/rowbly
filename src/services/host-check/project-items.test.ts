import { describe, expect, it } from "vitest";
import { HostTimeoutError } from "../host-transport/host-errors.js";
import { answerFor, healthyAnswers } from "../test-project/fake-host-answers.js";
import { createFakeHostTransport } from "../test-project/fake-host-transport.js";
import type { CheckEnv } from "./check-item.js";
import { cloneItem, localAheadItem, workerModels } from "./project-items.js";

const env: CheckEnv = {
  hostId: "mini",
  build: { id: "0.18.0", version: "0.18.0", released: true },
  project: { root: "/p", models: [] },
  transport: createFakeHostTransport({ bytes: (command) => answerFor(healthyAnswers(), command) }),
};

describe("project items", () => {
  it("collects each worker model one time", () => {
    const opus = { provider: "anthropic", modelId: "opus" };
    const gpt = { provider: "openai", modelId: "gpt" };

    expect(
      workerModels({
        maxWorkers: 1,
        workerModel: opus,
        stageWorkerModels: { A: gpt, B: { ...opus, thinkingLevel: "high" } },
        storyWorkerModels: { "ROW-1": { A: gpt } },
      }),
    ).toEqual([opus, gpt]);
    expect(workerModels({ maxWorkers: 1 })).toEqual([]);
    const sol = { provider: "openai", modelId: "gpt-sol" };
    expect(workerModels({ maxWorkers: 1, workerModel: opus, tagWorkerModels: { bug: sol, ui: opus } })).toEqual([
      opus,
      sol,
    ]);
  });

  it("gives a fail for an error of the clone finder", async () => {
    const check = await cloneItem(env, async () => {
      throw new HostTimeoutError("slow");
    });

    expect(check).toMatchObject({ path: undefined, item: { state: "fail", detail: "HOST_TIMEOUT: slow" } });
  });

  it("skips local-ahead when Git cannot count", async () => {
    const item = await localAheadItem(env, async () => {
      throw new Error("fatal: not a git repository");
    });

    expect(item).toMatchObject({
      state: "skipped",
      detail: "Git cannot count the local commits: fatal: not a git repository",
    });
  });
});
