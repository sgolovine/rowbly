import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthInteraction, AuthRuntime } from "../../../../services/agent-auth/agent-auth.js";
import { useTempDir } from "../../../../services/test-project/test-project.js";
import { createToastStore } from "../../../hooks/index.js";
import { type AuthSession, startLogin } from "./auth-session.js";

vi.mock("@earendil-works/pi-coding-agent", () => {
  throw new Error("The sign-in test must not load Pi");
});

afterEach(() => {
  vi.clearAllMocks();
});

function runtime(flow: (interaction: AuthInteraction) => Promise<void>) {
  return {
    getProviders: () => [{ id: "acme", auth: { apiKey: { login: {} } } }],
    login: vi.fn(async (_p: string, _t: string, interaction: AuthInteraction) => {
      await flow(interaction);
      return { type: "api_key", key: "k" };
    }),
    settleCredentialWrites: async () => {},
  } as unknown as AuthRuntime;
}

describe("authSession", () => {
  const home = useTempDir();

  function session(fake: AuthRuntime): AuthSession {
    return {
      ctx: { home: home.path },
      runtime: fake,
      provider: "acme",
      method: "api_key",
      toast: createToastStore(),
      done: { current: vi.fn() },
      abort: new AbortController(),
      setPending: vi.fn(),
      setText: vi.fn(),
      setEvents: vi.fn(),
    };
  }

  it("shows a prompt and signs in with the answer", async () => {
    const s = session(
      runtime(async (interaction) => {
        interaction.notify({ type: "progress", message: "Working" });
        expect(await interaction.prompt({ type: "secret", message: "Key" })).toBe("secret");
      }),
    );

    startLogin(s);

    await vi.waitFor(() => expect(s.setPending).toHaveBeenCalled());

    const pending = vi.mocked(s.setPending).mock.calls[0]?.[0] as { resolve(value: string): void };

    pending.resolve("secret");

    await vi.waitFor(() => expect(s.done.current).toHaveBeenCalledWith(true));
    expect(s.setEvents).toHaveBeenCalledOnce();
    expect(s.toast.list().map((t) => t.message)).toEqual(["Signed in to acme"]);
  });

  it("cancels the prompt on an abort and tells that the sign-in stopped", async () => {
    const s = session(
      runtime(async (interaction) => {
        await interaction.prompt({ type: "text", message: "Name" });
      }),
    );

    startLogin(s);

    await vi.waitFor(() => expect(s.setPending).toHaveBeenCalled());

    s.abort.abort();

    await vi.waitFor(() => expect(s.done.current).toHaveBeenCalledWith(false));
    expect(s.toast.list().map((t) => t.message)).toEqual(["Cancelled the sign-in to acme"]);
  });
});
