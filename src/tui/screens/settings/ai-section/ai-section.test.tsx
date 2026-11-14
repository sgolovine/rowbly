import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthInteraction, AuthRuntime } from "../../../../services/agent-auth/agent-auth.js";
import { listChecks } from "../../../../services/factory-settings/check-items.js";
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

  it("shows the signed-in providers first, the models and the limits on their own tabs", async () => {
    await updateFactorySettings(
      { supervisorModel: { provider: "acme", modelId: "deep-1", thinkingLevel: "high" } },
      project.ctx,
    );
    const { tui } = await open();
    expect(tui.frame()).toMatch(/Providers\s+Models\s+Limits\s+Checks/);
    expect(tui.frame()).toMatch(/acme\s+signed in with an API key/);
    expect(tui.frame()).not.toContain("zeta");
    expect(tui.frame()).toContain("+ Sign in to another provider");
    await tui.press(keys.right);
    expect(tui.frame()).toContain("Supervisor model");
    expect(tui.frame()).toContain("acme/deep-1 · thinking high");
    expect(tui.frame()).toMatch(/Worker model[\s\S]*Pi default/);
    await tui.press(keys.right);
    expect(tui.frame()).toContain("Worker limit");
    expect(tui.frame()).toContain("4 workers");
    expect(tui.frame()).toMatch(/Edit\s+l/);
    await tui.press(keys.right);
    expect(tui.frame()).toContain("Check limits");
    expect(tui.frame()).toContain("No checks. The workers run their checks in the shell.");
    await tui.press(keys.right);
    expect(tui.frame()).toContain("+ Sign in to another provider");
  });

  it("signs in on the page of the other providers, and esc goes back to the signed-in providers", async () => {
    const { tui, runtime } = await open();
    await tui.press("n");
    expect(tui.frame()).toContain("Sign in to another provider");
    expect(tui.frame()).toMatch(/zeta\s+not signed in/);
    expect(tui.frame()).not.toContain("acme");
    await tui.press(keys.enter);
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
    expect(tui.frame()).toMatch(/zeta\s+not signed in/);
    await tui.press(keys.escape);
    expect(tui.frame()).toMatch(/acme\s+signed in with an API key/);
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
    await tui.press(keys.left, keys.left);
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("2 workers");
    });
  });

  it("adds, edits and removes a check, and sets the check limits on the Checks tab", async () => {
    const { tui } = await open();
    await tui.press(keys.left);
    expect(tui.frame()).toContain("2 checks at the same time · keep 2048 MB free");

    await tui.press("n");
    expect(tui.frame()).toContain("AI › New check");
    await tui.type("test");
    await tui.press(keys.tab, keys.tab);
    await tui.type("pnpm test");
    await tui.press(keys.ctrl("s"));
    await vi.waitFor(async () => expect(await listChecks(project.ctx)).toHaveLength(1));
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toMatch(/test\s+full\s+pnpm test/);
    });

    await tui.press(keys.enter);
    expect(tui.frame()).toContain("AI › Check › test");
    await tui.type("Tests");
    await tui.press(keys.ctrl("s"));
    await vi.waitFor(async () => expect((await listChecks(project.ctx))[0]?.label).toBe("Tests"));

    await settle(30);
    await tui.press("c");
    expect(tui.frame()).toContain("AI › Check limits");
    await tui.press(keys.backspace);
    await tui.type("3");
    await tui.press(keys.ctrl("s"));
    await vi.waitFor(async () => expect((await getFactorySettings(project.ctx)).checks?.maxConcurrent).toBe(3));

    await settle(30);
    await tui.press("d");
    expect(tui.frame()).toContain("Remove the check test?");
    await tui.press("y");
    await vi.waitFor(async () => expect(await listChecks(project.ctx)).toEqual([]));
  });

  it("lists the Stages under the worker model, and sets and removes the override of a Stage", async () => {
    await updateFactorySettings({ maxWorkers: 3, workerModel: { provider: "acme", modelId: "fast-1" } }, project.ctx);
    const { tui } = await open();
    await tui.press(keys.right);
    expect(tui.frame()).toContain("Stage worker models");
    expect(tui.frame()).toMatch(/▌ ● Backlog\s+Worker model/);
    await tui.press(keys.down, keys.enter);
    expect(tui.frame()).toContain("AI › Worker model › Done");
    expect(tui.frame()).toContain("No override");
    await tui.type("deep");
    await tui.press(keys.enter, keys.down, keys.down, keys.down, keys.enter);
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.toasts.list().map((t) => t.message)).toContain(
        "Saved the Done worker model: acme/deep-1 · thinking low",
      );
    });
    expect(tui.frame()).not.toContain("AI › Worker model ›");
    expect(tui.frame()).toMatch(/● Done\s+acme\/deep-1 · thinking low/);
    expect(JSON.parse(await project.read("factory.json"))).toEqual({
      version: 1,
      maxWorkers: 3,
      workerModel: { provider: "acme", modelId: "fast-1" },
      stageWorkerModels: { DONE: { provider: "acme", modelId: "deep-1", thinkingLevel: "low" } },
    });
    await settle(30);
    await tui.press(keys.enter);
    expect(tui.frame()).toMatch(/▌\s*acme\/deep-1/);
    await tui.type("No override");
    await tui.press(keys.enter);
    await vi.waitFor(async () => {
      expect(JSON.parse(await project.read("factory.json"))).toEqual({
        version: 1,
        maxWorkers: 3,
        workerModel: { provider: "acme", modelId: "fast-1" },
      });
    });
  });
});
