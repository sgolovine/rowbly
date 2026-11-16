import { describe, expect, it } from "vitest";
import { ValidationError } from "../errors/errors.js";
import { HostTimeoutError } from "../host-transport/host-errors.js";
import { output } from "../test-project/fake-host-answers.js";
import { createFakeHostTransport } from "../test-project/fake-host-transport.js";
import { type CheckEnv, failureText, firstLine, item, runRemote, transportFailure } from "./check-item.js";

const BUILD = { id: "0.18.0", version: "0.18.0", released: true };

describe("check item", () => {
  it("gives the label of the id, and an action only when it is given", () => {
    expect(item("gh", "ok", "logged in")).toEqual({
      id: "gh",
      label: "GitHub CLI login",
      state: "ok",
      detail: "logged in",
    });
    expect(item("gh", "fail", "no", "Run gh auth login.")).toMatchObject({ action: "Run gh auth login." });
  });

  it("gives the first line, or the fallback for an empty text", () => {
    expect(firstLine("\n one \n two", "none")).toBe("one");
    expect(firstLine("  ", "none")).toBe("none");
    expect(failureText(output(3, ""))).toBe("exited with code 3");
  });

  it("gives a transport error as the result, and throws a bug", async () => {
    const error = new HostTimeoutError("slow");
    const env = (bytes: () => never): CheckEnv => ({
      hostId: "mini",
      build: BUILD,
      project: undefined,
      transport: createFakeHostTransport({ bytes }),
    });

    expect(
      await runRemote(
        env(() => {
          throw error;
        }),
        ["true"],
      ),
    ).toEqual({ ok: false, error });
    await expect(
      runRemote(
        env(() => {
          throw new TypeError("bug");
        }),
        ["true"],
      ),
    ).rejects.toThrow("bug");
    expect(
      await runRemote(
        env(() => {
          throw error;
        }),
        ["bad token"],
      ),
    ).toMatchObject({
      ok: false,
      error: expect.any(ValidationError),
    });
  });

  it("gives the code of a transport error and a default action", () => {
    const env = { hostId: "mini" } as CheckEnv;

    expect(transportFailure(env, "gh", new HostTimeoutError("slow"))).toEqual({
      id: "gh",
      label: "GitHub CLI login",
      state: "fail",
      detail: "HOST_TIMEOUT: slow",
      action: "Make sure that the SSH connection works, then run rowbly host check mini again.",
    });
  });
});
