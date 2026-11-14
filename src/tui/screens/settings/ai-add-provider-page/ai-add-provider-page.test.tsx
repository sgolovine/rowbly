import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keys, renderTui } from "../../../testing/index.js";
import type { AiProvider } from "../ai-view.js";
import { AiAddProviderPage, type AiAddProviderPageProps } from "./ai-add-provider-page.js";

afterEach(cleanup);

const providers = [
  { id: "zeta", methods: ["oauth"], configured: false },
  { id: "omega", methods: ["api_key"], configured: false },
] as unknown as AiProvider[];

function props(overrides: Partial<AiAddProviderPageProps> = {}): AiAddProviderPageProps {
  return {
    ready: true,
    providers,
    idle: true,
    canSignIn: true,
    height: 30,
    onHighlight: vi.fn(),
    onFilteringChange: vi.fn(),
    onPick: vi.fn(),
    onSignIn: vi.fn(),
    onBack: vi.fn(),
    ...overrides,
  };
}

describe("AiAddProviderPage", () => {
  it("lists the other providers and picks one with enter", async () => {
    const p = props();
    const tui = await renderTui(<AiAddProviderPage {...p} />);

    expect(tui.frame()).toContain("Sign in to another provider");
    expect(tui.frame()).toContain("zeta not signed in");
    expect(tui.frame()).toMatch(/Sign in\s+enter/);
    expect(tui.frame()).toMatch(/Back\s+esc/);

    await tui.press(keys.down, keys.enter);

    expect(p.onPick).toHaveBeenCalledWith("omega");

    await tui.click("Back");

    expect(p.onBack).toHaveBeenCalledOnce();
  });

  it("tells when all providers are signed in", async () => {
    const tui = await renderTui(<AiAddProviderPage {...props({ providers: [], canSignIn: false })} />);

    expect(tui.frame()).toContain("All providers are signed in.");
    expect(tui.frame()).not.toMatch(/Sign in\s+enter/);
  });
});
