import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthInteraction, AuthRuntime } from "../../../../services/agent-auth/agent-auth.js";
import { getFactorySettings, updateFactorySettings } from "../../../../services/factory-settings/factory-settings.js";
import { useTestProject } from "../../../../services/test-project/test-project.js";
import { keys, renderTui, settle } from "../../../testing/index.js";
import { AiSection } from "./ai-section.js";

vi.mock("@earendil-works/pi-coding-agent", () => {
  throw new Error("The AI settings test must not load Pi");
});

afterEach(cleanup);

/** Two providers: `acme` with a stored key and two models, and `zeta` with no sign-in. */
function fakeRuntime() {
  const models = [
    { provider: "acme", id: "deep-1", name: "Deep One", reasoning: true },
    { provider: "acme", id: "fast-1", name: "Fast One", reasoning: false },
  ];
  return {
    getProviders: () => [
      { id: "acme", auth: { apiKey: { login: {} } } },
      { id: "zeta", auth: { oauth: {} } },
    ],
    listCredentials: async () => [{ providerId: "acme", type: "api_key" }],
    getAvailable: async (provider?: string) => models.filter((m) => !provider || m.provider === provider),
    login: vi.fn(async (_p: string, _t: string, interaction: AuthInteraction) => {
      await interaction.prompt({ type: "text", message: "Name of this computer" });
      return { type: "oauth" };
    }),
    logout: vi.fn(async () => {}),
    settleCredentialWrites: async () => {},
  } as unknown as AuthRuntime;
}

describe("AiSection", () => {
  const project = useTestProject();

  async function open() {
    const runtime = fakeRuntime();
    const onChange = vi.fn();
    const loadRuntime = async () => runtime;
    const tui = await renderTui(
      <AiSection ctx={{ ...project.ctx, home: project.paths.root }} onChange={onChange} loadRuntime={loadRuntime} />,
    );
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("Providers");
    });
    return { tui, runtime, onChange };
  }

  it("shows the models, the worker limit and the status of each provider", async () => {
    await updateFactorySettings(
      { supervisorModel: { provider: "acme", modelId: "deep-1", thinkingLevel: "high" } },
      project.ctx,
    );
    const { tui } = await open();
    expect(tui.frame()).toMatch(/Supervisor\s+acme\/deep-1 · thinking high/);
    expect(tui.frame()).toMatch(/Workers\s+Pi default/);
    expect(tui.frame()).toMatch(/Worker limit\s+4/);
    expect(tui.frame()).toMatch(/acme\s+signed in with an API key/);
    expect(tui.frame()).toMatch(/zeta\s+not signed in/);
  });

  it("signs in with enter, and a cancelled sign-in gives the keys back to the section", async () => {
    const { tui, runtime } = await open();
    await tui.press(keys.down, keys.enter);
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("AI › Sign in › zeta");
      expect(tui.frame()).toContain("Name of this computer");
    });
    expect(runtime.login).toHaveBeenCalledWith("zeta", "oauth", expect.anything(), expect.anything());
    await tui.press(keys.escape);
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).not.toContain("AI › Sign in");
    });
    await tui.press("l");
    expect(tui.frame()).toContain("AI › Worker limit");
  });

  it("asks before it signs out", async () => {
    const { tui, runtime, onChange } = await open();
    await tui.press("d");
    expect(tui.frame()).toContain("Sign out of acme?");
    await tui.press("y");
    await vi.waitFor(() => expect(runtime.logout).toHaveBeenCalledWith("acme"));
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it("saves the worker model with its thinking level, and checks the worker limit", async () => {
    const { tui } = await open();
    await tui.press("w");
    await tui.type("deep");
    await tui.press(keys.enter);
    expect(tui.frame()).toContain("AI › Worker model › Thinking");
    await tui.press(keys.down, keys.enter);
    await vi.waitFor(async () =>
      expect((await getFactorySettings(project.ctx)).workerModel).toEqual({
        provider: "acme",
        modelId: "deep-1",
        thinkingLevel: "off",
      }),
    );
    await settle(30);
    await tui.press("l");
    await tui.press(keys.backspace);
    await tui.type("0");
    await tui.press(keys.enter);
    expect(tui.frame()).toContain("must be a whole number from 1");
    await tui.press(keys.backspace);
    await tui.type("2");
    await tui.press(keys.enter);
    await vi.waitFor(async () => expect((await getFactorySettings(project.ctx)).maxWorkers).toBe(2));
  });
});
