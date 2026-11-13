import { describe, expect, it } from "vitest";
import { aiHints, modelText, providerStatus } from "./ai-view.js";

describe("aiView", () => {
  it("names the sign-in state of a provider", () => {
    expect(providerStatus({ configured: true, credentialType: "oauth" })).toBe("signed in with an account");
    expect(providerStatus({ configured: true, credentialType: "api_key" })).toBe("signed in with an API key");
    expect(providerStatus({ configured: true })).toBe("configured outside Rowbly");
    expect(providerStatus({ configured: false })).toBe("not signed in");
  });

  it("names a model choice with its thinking level, or the Pi default", () => {
    expect(modelText(undefined)).toBe("Pi default");
    expect(modelText({ provider: "a", modelId: "m" })).toBe("a/m");
    expect(modelText({ provider: "a", modelId: "m", thinkingLevel: "high" })).toBe("a/m · thinking high");
  });

  it("offers only the keys that work now", () => {
    const can = { idle: true, list: false, signIn: false, signOut: false, ready: false };

    expect(aiHints({ ...can, idle: false })).toEqual([]);
    expect(aiHints(can).map((h) => h.key)).toEqual(["l", "r"]);
    expect(aiHints({ idle: true, list: true, signIn: true, signOut: true, ready: true }).map((h) => h.key)).toEqual([
      "↑/↓",
      "/",
      "enter",
      "d",
      "s",
      "w",
      "l",
      "r",
    ]);
  });
});
