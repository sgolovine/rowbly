import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { build } from "tsup";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { newOwner, probeOwner, readFactoryOwner } from "../factory-ownership/factory-ownership.js";
import { updateFactorySettings } from "../factory-settings/factory-settings.js";
import { initProject } from "../project/project.js";
import { createThread, getThread, listThreads } from "../thread/thread.js";
import { projectPaths } from "../workspace/workspace.js";
import { getFactoryStatus, restartFactory, startFactory, stopFactory } from "./factory.js";

const exec = promisify(execFile);
const repo = resolve(".");
describe("detached factory with offline Pi", () => {
  let dir: string;
  let hook: string;
  let bundle: string;
  let root: string | undefined;
  const pids = new Set<number>();
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "rowbly-daemon-test-"));
    const pkg = join(dir, "package");
    await mkdir(pkg);
    await writeFile(join(pkg, "package.json"), JSON.stringify({ name: "rowbly", type: "module", version: "0.0.0" }));
    for (const name of ["node_modules", "skills", "stages"]) await symlink(join(repo, name), join(pkg, name));
    bundle = join(pkg, "dist/cli.js");
    await build({
      config: false,
      entry: [join(repo, "src/cli.ts")],
      outDir: join(pkg, "dist"),
      format: ["esm"],
      platform: "node",
      target: "node22",
      external: [
        "@earendil-works/pi-coding-agent",
        ...Object.keys(JSON.parse(await readFile(join(repo, "package.json"), "utf8")).dependencies),
      ],
      silent: true,
    });
    const wrapper = join(dir, "offline-sdk.mjs");
    await writeFile(
      wrapper,
      `
      import * as sdk from ${JSON.stringify(import.meta.resolve("@earendil-works/pi-coding-agent"))};
      import { fauxProvider, InMemoryCredentialStore } from ${JSON.stringify(import.meta.resolve("@earendil-works/pi-ai"))};
      export * from ${JSON.stringify(import.meta.resolve("@earendil-works/pi-coding-agent"))};
      export const ModelRuntime = { async create() {
        const runtime = await sdk.ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
        runtime.registerNativeProvider(fauxProvider({ provider: "faux", api: "offline-faux" }).provider);
        return runtime;
      } };
      export const getAgentDir = () => ${JSON.stringify(join(dir, "empty-agent"))};
    `,
    );
    hook = join(dir, "hook.mjs");
    await writeFile(
      hook,
      `import { registerHooks } from "node:module";
      const nativeFetch = globalThis.fetch;
      globalThis.fetch = (url, ...args) => { if (String(url).startsWith("data:")) return nativeFetch(url, ...args); throw new Error("Network forbidden in daemon tests"); };
      process.env.HOME = ${JSON.stringify(join(dir, "empty-home"))};
      process.env.PI_CODING_AGENT_DIR = ${JSON.stringify(join(dir, "empty-agent"))};
      registerHooks({ resolve(s, c, next) { if (s === "@earendil-works/pi-coding-agent") return { url: ${JSON.stringify(pathToFileURL(wrapper).href)}, shortCircuit: true }; return next(s,c); } });`,
    );
  }, 30_000);
  afterEach(async () => {
    if (root) {
      const owner = await readFactoryOwner(projectPaths(root)).catch(() => undefined);
      if (owner) pids.add(owner.pid);
      await stopFactory({ timeoutMs: 3000 }, { cwd: root }).catch(() => {});
    }
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* Already stopped. */
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    const ps = (await exec("ps", ["-eo", "pid,args"])).stdout;
    // No daemon from this private fixture survives either success or failure.
    expect(ps.split("\n").filter((line) => line.includes(dir) && line.includes("factory run"))).toEqual([]);
    pids.clear();
    root = undefined;
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  it.each(["built", "tsx"])(
    "starts %s after cwd changes, fences twenty clients, and recovers after SIGKILL",
    async (mode) => {
      root = join(dir, `${mode} project with spaces`);
      await mkdir(root);
      await initProject({ name: "Daemon", key: "D" }, { cwd: root });
      await updateFactorySettings({ supervisorModel: { provider: "faux", modelId: "faux-1" } }, { cwd: root });
      await exec("git", ["init", root]);
      await exec("git", ["-C", root, "add", ".rowbly"]);
      await exec("git", [
        "-C",
        root,
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-m",
        "initial",
      ]);
      const launch = {
        executable: process.execPath,
        entry: mode === "built" ? bundle : join(repo, "src/cli.ts"),
        execArgv: [
          "--import",
          hook,
          ...(mode === "tsx" ? ["--import", pathToFileURL(join(repo, "node_modules/tsx/dist/loader.mjs")).href] : []),
        ],
      };
      const ctx = { cwd: root };
      const initial = await Promise.all(Array.from({ length: 3 }, () => startFactory({ launch }, ctx)));
      for (const s of initial) pids.add(s.owner.pid);
      expect(new Set(initial.map((s) => s.owner.token)).size).toBe(1);
      await Promise.all(Array.from({ length: 17 }, () => startFactory({ launch }, ctx)));
      expect((await listThreads({ role: "supervisor" }, ctx)).threads).toHaveLength(1);
      const first = initial[0];
      // The CLI client exits while its detached daemon remains ready.
      const result = await exec(
        process.execPath,
        [...launch.execArgv, launch.entry, "-C", root, "--json", "factory", "status"],
        {
          cwd: "/tmp",
          env: { ...process.env, HOME: join(dir, "empty-home"), PI_CODING_AGENT_DIR: join(dir, "empty-agent") },
        },
      );
      expect(JSON.parse(result.stdout).phase).toBe("ready");
      process.kill(first.owner.pid, "SIGKILL");
      await new Promise((resolve) => setTimeout(resolve, 100));
      await expect.poll(() => probeOwner(first.owner)).toBe("dead");
      const abandoned = await createThread(
        { role: "worker", storyId: "D-99", stage: "BACKLOG", cwd: root, ownerToken: "older-dead-generation" },
        ctx,
      );
      const restarted = await startFactory({ launch }, ctx);
      expect((await getThread(abandoned.id, ctx)).status).toBe("interrupted");
      pids.add(restarted.owner.pid);
      expect(restarted.owner.token).not.toBe(first.owner.token);
      const old = (await listThreads({ role: "supervisor" }, ctx)).threads[0];
      expect(old.status).toBe("interrupted");
      const final = await restartFactory({ launch }, ctx);
      pids.add(final.owner.pid);
      expect(final.phase).toBe("ready");
      await stopFactory({}, ctx);
      expect((await getFactoryStatus(ctx)).phase).toBe("stopped");
    },
    30_000,
  );
  it("returns early launch errors and refuses restart on stop timeout", async () => {
    root = join(dir, "failure project");
    await mkdir(root);
    await initProject({ name: "Failure", key: "F" }, { cwd: root });
    const fail = join(dir, "fail.mjs");
    await writeFile(fail, 'console.error("fixture early failure"); process.exitCode=1;');
    await expect(
      startFactory({ launch: { executable: process.execPath, entry: fail, execArgv: [] } }, { cwd: root }),
    ).rejects.toThrow(/fixture early failure/);
    const owner = await newOwner();
    const { acquireFactoryOwnership, releaseFactoryOwnership } = await import(
      "../factory-ownership/factory-ownership.js"
    );
    await acquireFactoryOwnership(projectPaths(root), owner);
    try {
      await expect(
        restartFactory(
          { launch: { executable: process.execPath, entry: fail, execArgv: [] }, timeoutMs: 50 },
          { cwd: root },
        ),
      ).rejects.toThrow(/timed out/);
      expect((await readFactoryOwner(projectPaths(root)))?.token).toBe(owner.token);
      // A stale thread remains historical; client status does not load Pi or change it.
      const t = await createThread({ role: "supervisor", cwd: root, ownerToken: owner.token }, { cwd: root });
      await getFactoryStatus({ cwd: root });
      expect((await getThread(t.id, { cwd: root })).status).toBe("pending");
    } finally {
      await releaseFactoryOwnership(projectPaths(root), owner.token);
    }
  });
});
