import { describe, expect, it } from "vitest";
import { answerFor, type FakeHostAnswers, healthyAnswers, output } from "../test-project/fake-host-answers.js";
import { createFakeHostTransport } from "../test-project/fake-host-transport.js";
import type { CheckEnv, ProjectFacts } from "./check-item.js";
import { hostProviders, modelsItem, piLoginItem } from "./pi-items.js";

const env = (overrides: FakeHostAnswers = {}, project?: ProjectFacts): CheckEnv => ({
  hostId: "mini",
  build: { id: "0.18.0", version: "0.18.0", released: true },
  project,
  transport: createFakeHostTransport({ bytes: (command) => answerFor({ ...healthyAnswers(), ...overrides }, command) }),
});

describe("pi items", () => {
  it("gives the configured providers", async () => {
    expect(await hostProviders(env())).toEqual({ providers: ["anthropic"] });
    expect(await piLoginItem(env())).toMatchObject({ state: "ok", detail: "anthropic" });
  });

  it("gives a fail for a failed command and for JSON of a different form", async () => {
    expect(await piLoginItem(env({ "rowbly-auth": output(1, "", "Error: broken") }))).toMatchObject({
      state: "fail",
      detail: "Error: broken",
    });
    expect(await piLoginItem(env({ "rowbly-auth": output(0, '{"id":"x"}') }))).toMatchObject({ state: "fail" });
  });

  it("skips models outside a Project and finds the models of the Project", async () => {
    const project = { root: "/p", models: [{ provider: "anthropic", modelId: "claude-opus-4-5" }] };

    expect(await modelsItem(env())).toMatchObject({ state: "skipped" });
    expect(await modelsItem(env({}, project))).toMatchObject({ state: "ok", detail: "anthropic/claude-opus-4-5" });
  });
});
