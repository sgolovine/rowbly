import { describe, expect, it } from "vitest";
import { answerFor, type FakeHostAnswers, healthyAnswers, output } from "../test-project/fake-host-answers.js";
import { createFakeHostTransport } from "../test-project/fake-host-transport.js";
import type { CheckEnv } from "./check-item.js";
import { identityItem, linuxItem, nodeItem, rowblyItem } from "./host-items.js";

const env = (overrides: FakeHostAnswers = {}): CheckEnv => ({
  hostId: "mini",
  build: { id: "0.18.0", version: "0.18.0", released: true },
  project: undefined,
  transport: createFakeHostTransport({ bytes: (command) => answerFor({ ...healthyAnswers(), ...overrides }, command) }),
});

describe("host items", () => {
  it("reads Linux from uname -s", () => {
    expect(linuxItem(output(0, "Linux\n"))).toMatchObject({ state: "ok", detail: "Linux" });
    expect(linuxItem(output(0, "Darwin\n"))).toMatchObject({ state: "fail", detail: "uname -s gives Darwin" });
  });

  it("gives the Node version, or the hint of the Node error", async () => {
    expect(await nodeItem(env())).toMatchObject({ state: "ok", detail: "v22.19.0" });
    expect(await nodeItem(env({ node: output(0, "v22.18.9\n") }))).toMatchObject({
      state: "fail",
      action: "Install Node v22.19.0 or later on the host.",
    });
  });

  it("compares the remote Rowbly version with the local version", async () => {
    expect(await rowblyItem(env())).toMatchObject({ state: "ok" });
    expect((await rowblyItem(env({ "rowbly-version": output(0, "0.17.0\n") }))).detail).toContain("prints 0.17.0");
  });

  it("names each missing identity value", async () => {
    const both = { "git-config-user.name": output(1, ""), "git-config-user.email": output(1, "") };

    expect(await identityItem(env(), undefined)).toMatchObject({ state: "ok", detail: "Ada <ada@example.com>" });
    expect(await identityItem(env(both), undefined)).toMatchObject({
      state: "fail",
      detail: "user.name and user.email has no value",
    });
  });
});
