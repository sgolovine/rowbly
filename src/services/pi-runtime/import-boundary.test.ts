import { describe, expect, it, vi } from "vitest";
import { useTempDir, useTestProject } from "../test-project/test-project.js";

vi.mock("@earendil-works/pi-coding-agent", () => {
  throw new Error("Pi loaded during command registration");
});

describe("Pi import boundary", () => {
  const project = useTestProject();
  const home = useTempDir();

  it("reads and writes the model cache without loading Pi", async () => {
    const cache = await import("../pi-catalog-cache/pi-catalog-cache.js");
    const ctx = { home: home.path };
    const catalog = { models: [], providers: [] };
    await cache.writePiCatalog(catalog, await cache.piCatalogKey(ctx, { env: {} }), ctx);
    expect(await cache.readPiCatalog(ctx, { env: {} })).toEqual({ ...catalog, fresh: true });
    await cache.deletePiCatalog(ctx);
    expect(await cache.readPiCatalog(ctx, { env: {} })).toBeUndefined();
  });

  it("does not load Pi for help or command registration", async () => {
    const { createProgram } = await import("../../commands/test-cli/test-cli.js");
    expect(createProgram().helpInformation()).toContain("Usage:");
    await expect(import("./pi-runtime.js")).resolves.toHaveProperty("loadPi");
  });

  it("reads factory status without loading Pi or credentials", async () => {
    const { runCli } = await import("../../commands/test-cli/test-cli.js");
    const result = await runCli(["--json", "factory", "status"], project.paths.root);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).phase).toBe("stopped");
  });

  it("reads the project status without loading Pi", async () => {
    const { runCli } = await import("../../commands/test-cli/test-cli.js");
    const result = await runCli(["--json", "status"], project.paths.root);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).factory.phase).toBe("stopped");
  });

  it("renders the TUI without the preload prop and does not load Pi", async () => {
    const { createElement } = await import("react");
    const { App } = await import("../../tui/app.js");
    const { createToastStore } = await import("../../tui/hooks/index.js");
    const { renderTui, settle } = await import("../../tui/testing/index.js");
    const tui = await renderTui(
      createElement(App, { toasts: createToastStore(), ctx: project.ctx, fullscreen: false }),
    );
    await vi.waitFor(() => expect(tui.frame()).toContain("+ New Story"));
    await settle(700);
    await tui.press();
    expect(tui.frame()).toContain("+ New Story");
    tui.unmount();
  });
});
