import { describe, expect, it, vi } from "vitest";
import { type AuthRuntime, getAuthStatus, listAvailableModels } from "../agent-auth/agent-auth.js";
import { ValidationError } from "../errors/errors.js";
import { answerPiRequest } from "./pi-worker.js";
import type { PiWorkerKind } from "./pi-worker-protocol.js";

vi.mock("@earendil-works/pi-coding-agent", () => {
  throw new Error("The Pi worker test must not load Pi");
});

/** A faux runtime. `signedIn` is the credential state on disk when the worker creates the runtime. */
function fakeRuntime(signedIn: boolean): AuthRuntime {
  return {
    getProviders: () => [{ id: "acme", auth: { apiKey: { login: true } } }],
    listCredentials: async () => (signedIn ? [{ providerId: "acme", type: "api_key" }] : []),
    getAvailable: async () =>
      signedIn ? [{ provider: "acme", id: "fast-1", name: "Fast One", reasoning: false }] : [],
  } as unknown as AuthRuntime;
}

describe("answerPiRequest", () => {
  it("answers `models` and `authStatus` with the data of `listAvailableModels` and `getAuthStatus`", async () => {
    const runtime = fakeRuntime(true);
    const loader = async () => runtime;

    expect(await answerPiRequest({ id: 1, kind: "models" }, loader)).toEqual({
      id: 1,
      ok: true,
      data: await listAvailableModels(runtime),
    });
    expect(await answerPiRequest({ id: 2, kind: "authStatus" }, loader)).toEqual({
      id: 2,
      ok: true,
      data: await getAuthStatus(runtime),
    });
  });

  it("sends plain data that a structured clone keeps", async () => {
    const reply = await answerPiRequest({ id: 3, kind: "authStatus" }, async () => fakeRuntime(true));
    expect(structuredClone(reply)).toEqual(reply);
  });

  it("creates a new runtime for each request, so that a change of credentials shows in the next answer", async () => {
    const disk = { signedIn: false };
    const loader = vi.fn(async () => fakeRuntime(disk.signedIn));

    const before = await answerPiRequest({ id: 1, kind: "authStatus" }, loader);
    disk.signedIn = true;
    const status = await answerPiRequest({ id: 2, kind: "authStatus" }, loader);
    const models = await answerPiRequest({ id: 3, kind: "models" }, loader);

    expect(loader).toHaveBeenCalledTimes(3);
    expect(before).toMatchObject({ ok: true, data: [{ id: "acme", configured: false }] });
    expect(status).toMatchObject({ ok: true, data: [{ id: "acme", configured: true, credentialType: "api_key" }] });
    expect(models).toMatchObject({ ok: true, data: [{ modelId: "fast-1" }] });
  });

  it.each<PiWorkerKind>(["models", "authStatus"])(
    "answers `%s` with a fixed message, without a stack or credential text, when the loader rejects",
    async (kind) => {
      const reply = await answerPiRequest({ id: 7, kind }, async () => {
        throw new Error("401 for key sk-secret-123");
      });
      expect(reply).toEqual({ id: 7, ok: false, message: expect.stringMatching(/^Pi could not/) });
      expect(JSON.stringify(reply)).not.toContain("sk-secret");
      expect(reply).not.toHaveProperty("stack");
    },
  );

  it("keeps the message of a Rowbly error", async () => {
    const reply = await answerPiRequest({ id: 8, kind: "models" }, async () => {
      throw new ValidationError("No Pi agent folder");
    });
    expect(reply).toEqual({ id: 8, ok: false, message: "No Pi agent folder" });
  });

  it("answers an unknown request with an error", async () => {
    const loader = vi.fn(async () => fakeRuntime(true));
    const reply = await answerPiRequest({ id: 9, kind: "other" as PiWorkerKind }, loader);
    expect(reply).toEqual({ id: 9, ok: false, message: "Pi could not answer" });
    expect(loader).not.toHaveBeenCalled();
  });
});
