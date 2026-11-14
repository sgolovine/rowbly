import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newOwner } from "../../../services/factory-ownership/factory-ownership.js";
import { listKnownProjects } from "../../../services/known-project/known-project.js";
import { prepareRuntime } from "../../../services/runtime-files/runtime-files.js";
import { createStory } from "../../../services/story/story.js";
import { useTempDir, useTestProject } from "../../../services/test-project/test-project.js";
import { runtimePaths, type ServiceContext } from "../../../services/workspace/workspace.js";
import { renderTui, settle } from "../../testing/index.js";
import { type ShellData, useShellData } from "./use-shell-data.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function boardText(shell: ShellData): string {
  if (shell.data.loading) {
    return "loading";
  }

  return shell.data.data ? `${shell.data.data.project.projectName}: ${shell.data.data.stories.length}` : "none";
}

/** Shows the board, and gives the last data to the test. */
function Probe({ ctx, onData }: { ctx: ServiceContext; onData(shell: ShellData): void }) {
  const shell = useShellData(ctx);

  onData(shell);

  return <Text>{boardText(shell)}</Text>;
}

/** Shows the phase of the factory. */
function FactoryProbe({ ctx }: { ctx: ServiceContext }) {
  const shell = useShellData(ctx);

  return <Text>{`factory:${shell.factory.data?.phase ?? "none"}`}</Text>;
}

describe("useShellData", () => {
  const project = useTestProject();
  const empty = useTempDir();

  it("reads the board, records the Project and reads the board again on reload", async () => {
    const seen: ShellData[] = [];
    const tui = await renderTui(<Probe ctx={project.ctx} onData={(shell) => seen.push(shell)} />);

    await settle(100);
    expect(tui.frame()).toContain("Rowbly: 0");
    // The hook records the Project after the board shows.
    await vi.waitFor(async () =>
      expect(
        (await listKnownProjects({ home: project.ctx.home })).some((known) => known.path === project.ctx.cwd),
      ).toBe(true),
    );

    await createStory({ title: "One" }, project.ctx);
    seen.at(-1)?.reload();
    await settle(100);
    await tui.press();
    expect(tui.frame()).toContain("Rowbly: 1");
  });

  it("gives null in a directory without a Project", async () => {
    const tui = await renderTui(<Probe ctx={{ cwd: empty.path }} onData={() => {}} />);

    await settle(100);
    await tui.press();
    expect(tui.frame()).toContain("none");
  });

  it("shows a factory that stops without a file write as stopped in under 10 s", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await prepareRuntime(project.paths);
    const owner = await newOwner();
    const status = { version: 1, phase: "ready", owner, heartbeatAt: new Date().toISOString() };
    await writeFile(runtimePaths(project.paths).lockFile, JSON.stringify(owner));
    await writeFile(join(project.paths.runtimeDir, "status.json"), JSON.stringify(status));
    const tui = await renderTui(<FactoryProbe ctx={project.ctx} />);
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("factory:ready");
    });

    // The owner process goes away, and no file changes.
    const kill = process.kill.bind(process);
    vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (pid === owner.pid) {
        throw Object.assign(new Error("no process"), { code: "ESRCH" });
      }
      return kill(pid, signal);
    });
    // `vi.waitFor` moves the fake time, so these checks wait with real time only.
    await vi.advanceTimersByTimeAsync(4000);
    await settle(200);
    await tui.press();
    expect(tui.frame()).toContain("factory:ready");
    await vi.advanceTimersByTimeAsync(1000);
    for (let i = 0; i < 40 && !tui.frame().includes("factory:stopped"); i++) {
      await settle(25);
      await tui.press();
    }
    expect(tui.frame()).toContain("factory:stopped");
  });
});
