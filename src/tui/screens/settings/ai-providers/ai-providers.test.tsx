import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keys, renderTui } from "../../../testing/index.js";
import type { AiProvider } from "../ai-view.js";
import { AiProviders, type AiProvidersProps } from "./ai-providers.js";

afterEach(cleanup);

const providers = [
  { id: "acme", methods: ["api_key"], configured: true, credentialType: "api_key" },
  { id: "zeta", methods: ["oauth"], configured: false },
] as unknown as AiProvider[];

function props(overrides: Partial<AiProvidersProps> = {}): AiProvidersProps {
  return {
    loading: false,
    ready: true,
    providers,
    idle: true,
    height: 30,
    onHighlight: vi.fn(),
    onSelect: vi.fn(),
    onFilteringChange: vi.fn(),
    ...overrides,
  };
}

describe("AiProviders", () => {
  it("shows a loading state and a load failure", async () => {
    const loading = await renderTui(<AiProviders {...props({ loading: true })} />);

    expect(loading.frame()).toContain("Loading the AI providers");

    const failed = await renderTui(<AiProviders {...props({ ready: false })} />);

    expect(failed.frame()).toContain("Rowbly cannot load the AI providers");
  });

  it("lists the providers with their status and selects one with enter", async () => {
    const p = props();
    const tui = await renderTui(<AiProviders {...p} />);

    expect(tui.frame()).toContain("acme signed in with an API key");
    expect(tui.frame()).toContain("zeta not signed in");

    await tui.press(keys.down);
    await tui.press(keys.enter);

    expect(p.onHighlight).toHaveBeenLastCalledWith("zeta");
    expect(p.onSelect).toHaveBeenCalledWith("zeta");
  });
});
