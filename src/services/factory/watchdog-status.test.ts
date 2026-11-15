import { type ChildProcess, spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { newOwner, probeOwner } from "../factory-ownership/factory-ownership.js";
import { readWatchdogState, writeWatchdogState } from "../factory-watchdog/factory-watchdog.js";
import { useTestProject } from "../test-project/test-project.js";
import { getFactoryStatus, startFactory, stopFactory } from "./factory.js";

const repo = resolve(".");

describe("factory watchdog control", () => {
  const project = useTestProject();
  const children: ChildProcess[] = [];

  afterEach(() => {
    for (const child of children.splice(0)) child.kill("SIGKILL");
  });

  /** A fake daemon that counts its starts and crashes with code 7. */
  async function crashingDaemon(): Promise<{ entry: string; counter: string }> {
    const counter = join(project.paths.root, "starts.txt");
    const entry = join(project.paths.root, "crash.mjs");
    await writeFile(counter, "");
    await writeFile(
      entry,
      `import { appendFileSync } from "node:fs"; appendFileSync(${JSON.stringify(counter)}, "x\\n"); process.exit(7);`,
    );
    return { entry, counter };
  }

  it("stops a watchdog in its back-off with SIGTERM, and no daemon starts after the stop", async () => {
    const daemon = await crashingDaemon();
    const fixture = join(project.paths.root, "watchdog.mjs");
    const runner = pathToFileURL(join(repo, "src/commands/factory-runner/watchdog-runner.ts")).href;
    const launch = { executable: process.execPath, execArgv: [], entry: daemon.entry };
    // A watchdog process with a long back-off. The test gives the timing through the function parameter.
    await writeFile(
      fixture,
      `const { runWatchdog } = await import(${JSON.stringify(runner)});
      const controller = new AbortController();
      process.on("SIGTERM", () => controller.abort());
      await runWatchdog({ launch: ${JSON.stringify(launch)}, signal: controller.signal,
        timing: { backoffMs: [60000], crashLimit: 5, stableMs: 60000 } }, { cwd: ${JSON.stringify(project.paths.root)} });`,
    );
    const loader = pathToFileURL(join(repo, "node_modules/tsx/dist/loader.mjs")).href;
    const child = spawn(process.execPath, ["--import", loader, fixture], { cwd: project.paths.root, stdio: "ignore" });
    children.push(child);
    const exited = new Promise((done) => child.once("exit", done));

    await expect.poll(async () => (await readWatchdogState(project.paths))?.phase, { timeout: 10_000 }).toBe("backoff");
    expect(await getFactoryStatus(project.ctx)).toMatchObject({ phase: "starting", restarts: 1 });

    expect(await stopFactory({ timeoutMs: 10_000 }, project.ctx)).toEqual({ phase: "stopped" });
    await exited;
    const state = await readWatchdogState(project.paths);
    expect(state?.phase).toBe("stopped");
    expect(await probeOwner(state?.process as never)).toBe("dead");
    expect((await readFile(daemon.counter, "utf8")).split("\n").filter(Boolean)).toHaveLength(1);
    expect((await getFactoryStatus(project.ctx)).phase).toBe("stopped");
  }, 20_000);

  it("launches a new watchdog after the failed phase", async () => {
    const self = await newOwner();
    const dead = { ...self, token: "dead-watchdog", processIdentity: "not-this-process" };
    await writeWatchdogState(project.paths, {
      version: 1,
      pid: self.pid,
      process: dead,
      phase: "failed",
      crashCount: 5,
      lastCrashAt: new Date().toISOString(),
      lastExit: "code 1",
      updatedAt: new Date().toISOString(),
    });
    expect((await getFactoryStatus(project.ctx)).phase).toBe("failed");
    // Stop has nothing to stop and keeps the failed record for the next start.
    expect(await stopFactory({}, project.ctx)).toEqual({ phase: "stopped" });

    const marker = join(project.paths.root, "launched");
    const entry = join(project.paths.root, "mark.mjs");
    await writeFile(
      entry,
      `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, process.argv.slice(2).join(" "));`,
    );
    await expect(
      startFactory({ launch: { executable: process.execPath, execArgv: [], entry } }, project.ctx),
    ).rejects.toThrow(/exited before ready/);
    expect(await readFile(marker, "utf8")).toContain("factory watchdog");
  });

  it("does not launch a second watchdog while a live watchdog waits in its back-off", async () => {
    const self = await newOwner();
    await writeWatchdogState(project.paths, {
      version: 1,
      pid: self.pid,
      process: self,
      phase: "backoff",
      crashCount: 1,
      updatedAt: new Date().toISOString(),
    });
    const marker = join(project.paths.root, "launched");
    const entry = join(project.paths.root, "mark.mjs");
    await writeFile(entry, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "x");`);
    await expect(
      startFactory({ launch: { executable: process.execPath, execArgv: [], entry }, timeoutMs: 200 }, project.ctx),
    ).rejects.toThrow(/timed out/);
    await expect(readFile(marker, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
