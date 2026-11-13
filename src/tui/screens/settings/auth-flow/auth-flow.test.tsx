import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthInteraction, AuthRuntime } from "../../../../services/agent-auth/agent-auth.js";
import { useTempDir } from "../../../../services/test-project/test-project.js";
import { keys, renderTui, settle } from "../../../testing/index.js";
import { AuthFlow } from "./auth-flow.js";

vi.mock("@earendil-works/pi-coding-agent", () => {
  throw new Error("The sign-in test must not load Pi");
});

afterEach(cleanup);

/** A runtime with one provider whose `login` runs `flow`. */
function runtime(flow: (interaction: AuthInteraction) => Promise<void>, methods = { oauth: true, apiKey: true }) {
  return {
    getProviders: () => [
      {
        id: "acme",
        auth: { ...(methods.oauth ? { oauth: {} } : {}), ...(methods.apiKey ? { apiKey: { login: {} } } : {}) },
      },
    ],
    listCredentials: async () => [],
    getAvailable: async () => [],
    login: vi.fn(async (_provider: string, _type: string, interaction: AuthInteraction) => {
      await flow(interaction);
      return { type: "api_key", key: "stored" };
    }),
    logout: vi.fn(),
    settleCredentialWrites: async () => {},
  } as unknown as AuthRuntime;
}

describe("AuthFlow", () => {
  const home = useTempDir();

  async function open(fake: AuthRuntime, methods: ("oauth" | "api_key")[]) {
    const onDone = vi.fn();
    const tui = await renderTui(
      <AuthFlow ctx={{ home: home.path }} runtime={fake} provider="acme" methods={methods} onDone={onDone} />,
    );
    await settle(30);
    return { tui, onDone };
  }

  it("asks for the method, then masks the API key and never shows it", async () => {
    let key = "";
    const fake = runtime(async (interaction) => {
      key = await interaction.prompt({ type: "secret", message: "Paste the API key" });
    });
    const { tui, onDone } = await open(fake, ["oauth", "api_key"]);
    expect(tui.frame()).toContain("Select how to sign in");
    await tui.press(keys.down, keys.enter);
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("Paste the API key");
    });
    await tui.type("sk-secret-42");
    expect(tui.frame()).not.toContain("sk-secret-42");
    expect(tui.frame()).toContain("••••");
    await tui.press(keys.enter);
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith(true));
    expect(key).toBe("sk-secret-42");
    expect(fake.login).toHaveBeenCalledWith("acme", "api_key", expect.anything(), expect.anything());
    expect(tui.toasts.list().map((t) => t.message)).toEqual(["Signed in to acme"]);
    expect(JSON.stringify(tui.toasts.list())).not.toContain("sk-secret");
  });

  it("shows the device code, and removes the manual prompt when the callback completes the step", async () => {
    let callback = () => {};
    const fake = runtime(async (interaction) => {
      interaction.notify({ type: "device_code", userCode: "WXYZ-1234", verificationUri: "https://acme.test/device" });
      const step = new AbortController();
      callback = () => step.abort();
      await interaction
        .prompt({ type: "manual_code", message: "Paste the code from the browser", signal: step.signal })
        .catch(() => "");
      interaction.notify({ type: "progress", message: "Waiting for the provider" });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const { tui, onDone } = await open(fake, ["oauth"]);
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("Paste the code from the browser");
    });
    expect(tui.frame()).toContain("WXYZ-1234");
    expect(tui.frame()).toContain("https://acme.test/device");
    callback();
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).not.toContain("Paste the code from the browser");
    });
    expect(tui.frame()).toContain("Waiting for the provider");
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith(true));
  });

  it("asks a choice of the provider and cancels the sign-in with esc", async () => {
    const fake = runtime(async (interaction) => {
      await interaction.prompt({
        type: "select",
        message: "Select the organization",
        options: [
          { id: "one", label: "One" },
          { id: "two", label: "Two" },
        ],
      });
      await interaction.prompt({ type: "text", message: "Name of this computer" });
    });
    const { tui, onDone } = await open(fake, ["oauth"]);
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("Select the organization");
    });
    await tui.press(keys.enter);
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("Name of this computer");
    });
    await tui.press(keys.escape);
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith(false));
    expect(tui.toasts.list().map((t) => t.message)).toEqual(["Cancelled the sign-in to acme"]);
  });
});
