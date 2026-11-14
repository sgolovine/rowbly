import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTempDir, useTestProject } from "../../../services/test-project/test-project.js";
import type { ServiceContext } from "../../../services/workspace/workspace.js";
import { renderTui, settle } from "../../testing/index.js";
import { Shell } from "./shell.js";
import { PI_PRELOAD_DELAY_MS, usePiPreload } from "./use-pi-preload.js";
import { type ShellData, useShellData } from "./use-shell-data.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Probe({
  ctx,
  preloadPi,
  onData,
}: {
  ctx: ServiceContext;
  preloadPi: () => Promise<void>;
  onData?: (shell: ShellData) => void;
}) {
  const shell = useShellData(ctx, preloadPi);

  onData?.(shell);

  return <Text>{shell.data.loading ? "loading" : `board:${shell.data.data ? "yes" : "none"}`}</Text>;
}

function HookProbe({ ready, preload }: { ready: boolean; preload?: () => Promise<void> }) {
  usePiPreload(ready, preload);

  return <Text>{ready ? "ready" : "waiting"}</Text>;
}

describe("usePiPreload", () => {
  const project = useTestProject();
  const empty = useTempDir();

  it("waits for the board and the delay, calls the preload one time, and not again after a reload", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const preload = vi.fn(() => Promise.resolve());
    const seen: ShellData[] = [];
    const tui = await renderTui(<Probe ctx={project.ctx} preloadPi={preload} onData={(s) => seen.push(s)} />);

    // The board has not resolved in the first render.
    expect(seen[0]?.data.loading).toBe(true);
    expect(preload).not.toHaveBeenCalled();

    // `vi.waitFor` moves the fake time, so this wait uses real time only.
    for (let i = 0; i < 80 && !tui.frame().includes("board:yes"); i++) {
      await settle(25);
      await tui.press();
    }
    expect(tui.frame()).toContain("board:yes");
    expect(preload).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(PI_PRELOAD_DELAY_MS - 50);
    expect(preload).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    expect(preload).toHaveBeenCalledTimes(1);

    seen.at(-1)?.reload();
    await settle(100);
    await tui.press();
    expect(tui.frame()).toContain("board:yes");
    await vi.advanceTimersByTimeAsync(PI_PRELOAD_DELAY_MS * 4);
    expect(preload).toHaveBeenCalledTimes(1);
  });

  it("does not call the preload in a directory without a Project", async () => {
    const preload = vi.fn(() => Promise.resolve());
    const tui = await renderTui(<Probe ctx={{ cwd: empty.path }} preloadPi={preload} />);

    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("board:none");
    });
    await settle(PI_PRELOAD_DELAY_MS + 200);
    expect(preload).not.toHaveBeenCalled();
  });

  it("does not call the preload after an unmount before the timer fires", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const preload = vi.fn(() => Promise.resolve());
    const tui = await renderTui(<HookProbe ready preload={preload} />);

    await vi.advanceTimersByTimeAsync(PI_PRELOAD_DELAY_MS - 100);
    tui.unmount();
    await vi.advanceTimersByTimeAsync(PI_PRELOAD_DELAY_MS * 2);
    expect(preload).not.toHaveBeenCalled();
  });

  it("does nothing without a preload function", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const tui = await renderTui(<HookProbe ready />);

    await vi.advanceTimersByTimeAsync(PI_PRELOAD_DELAY_MS * 2);
    expect(tui.frame()).toContain("ready");
  });

  it("shows no toast and no error when the preload rejects", async () => {
    const preload = vi.fn(() => Promise.reject(new Error("Pi import failed")));
    const tui = await renderTui(<Shell ctx={project.ctx} preloadPi={preload} />);

    await vi.waitFor(() => expect(preload).toHaveBeenCalledTimes(1), { timeout: 3000 });
    await settle(100);
    await tui.press();
    expect(tui.toasts.list()).toEqual([]);
    expect(tui.frame()).not.toContain("Pi import failed");
  });
});
