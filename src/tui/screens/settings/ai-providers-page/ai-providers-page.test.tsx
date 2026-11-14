import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTui } from "../../../testing/index.js";
import type { AiProvider } from "../ai-view.js";
import { AiProvidersPage, type AiProvidersPageProps } from "./ai-providers-page.js";

afterEach(cleanup);

const providers = [
  { id: "acme", methods: ["api_key"], configured: true, credentialType: "api_key" },
] as unknown as AiProvider[];

function props(overrides: Partial<AiProvidersPageProps> = {}): AiProvidersPageProps {
  return {
    loading: false,
    ready: true,
    providers,
    idle: true,
    canSignOut: true,
    height: 30,
    onHighlight: vi.fn(),
    onFilteringChange: vi.fn(),
    onAddProvider: vi.fn(),
    onSignOut: vi.fn(),
    onReload: vi.fn(),
    ...overrides,
  };
}

describe("AiProvidersPage", () => {
  it("lists the signed-in providers with a link to sign in to another provider", async () => {
    const p = props();
    const tui = await renderTui(<AiProvidersPage {...p} />);

    expect(tui.frame()).toContain("Signed in");
    expect(tui.frame()).toContain("acme signed in with an API key");
    expect(tui.frame()).toMatch(/\+ Sign in to another provider\s+n/);
    expect(tui.frame()).toMatch(/Sign out\s+d/);

    await tui.click("+ Sign in to another provider");

    expect(p.onAddProvider).toHaveBeenCalledOnce();
  });

  it("shows no link and no Sign out Button before the providers load", async () => {
    const tui = await renderTui(<AiProvidersPage {...props({ ready: false, canSignOut: false, providers: [] })} />);

    expect(tui.frame()).toContain("Rowbly cannot load the AI providers");
    expect(tui.frame()).not.toContain("Sign in to another provider");
    expect(tui.frame()).not.toContain("Sign out");
    expect(tui.frame()).toContain("Reload");
  });

  it("tells when no provider is signed in", async () => {
    const tui = await renderTui(<AiProvidersPage {...props({ providers: [], canSignOut: false })} />);

    expect(tui.frame()).toContain("No provider is signed in.");
  });
});
