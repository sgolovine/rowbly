import { mkdir, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as files from "../files/files.js";
import { useTempDir } from "../test-project/test-project.js";
import {
  deletePiCatalog,
  type PiCatalog,
  piAgentDir,
  piCatalogFile,
  piCatalogKey,
  readPiCatalog,
  writePiCatalog,
} from "./pi-catalog-cache.js";

vi.mock("../files/files.js", async (original) => {
  const actual = await original<typeof import("../files/files.js")>();
  return { ...actual, writeFileAtomic: vi.fn(actual.writeFileAtomic) };
});

const catalog: PiCatalog = {
  models: [{ provider: "acme", modelId: "fast-1", name: "Fast One", thinkingLevels: ["off"] }],
  providers: [
    { id: "acme", methods: ["api_key"], configured: true, credentialType: "api_key", health: "unverified" },
    { id: "other", methods: ["oauth"], configured: false, credentialType: undefined, health: "unverified" },
  ],
};

describe("pi catalog cache", () => {
  const home = useTempDir();
  // An empty environment, so that a PI_CODING_AGENT_DIR of the person who runs the tests does not apply.
  const options = { env: {} };
  const ctx = () => ({ home: home.path });
  const agentFile = (name: string) => join(home.path, ".pi", "agent", name);

  afterEach(() => vi.clearAllMocks());

  async function write(version?: string) {
    await writePiCatalog(catalog, await piCatalogKey(ctx(), { ...options, version }), ctx());
  }

  async function touch(name: string, seconds: number) {
    await mkdir(join(home.path, ".pi", "agent"), { recursive: true });
    await writeFile(agentFile(name), "{}");
    await utimes(agentFile(name), seconds, seconds);
  }

  it("keeps the file in the cache folder of the home directory, outside .rowbly/", () => {
    expect(piCatalogFile(ctx())).toBe(join(home.path, ".cache", "rowbly", "pi-catalog.json"));
  });

  it("finds the Pi agent folder as Pi does, without Pi", () => {
    expect(piAgentDir(ctx(), options)).toBe(join(home.path, ".pi", "agent"));
    expect(piAgentDir(ctx(), { env: { PI_CODING_AGENT_DIR: "/opt/pi" } })).toBe("/opt/pi");
    expect(piAgentDir(ctx(), { env: { PI_CODING_AGENT_DIR: "~/pi-agent" } })).toBe(join(home.path, "pi-agent"));
    expect(piAgentDir(ctx(), { env: { PI_CODING_AGENT_DIR: "~" } })).toBe(home.path);
  });

  it("reads back the same models and providers when the key is unchanged", async () => {
    await touch("auth.json", 1000);
    await write();
    expect(await readPiCatalog(ctx(), options)).toEqual({ ...catalog, fresh: true });
  });

  it("writes atomically and creates the missing parent folder", async () => {
    await write();
    expect(files.writeFileAtomic).toHaveBeenCalledWith(piCatalogFile(ctx()), expect.any(String));
    expect(await readdir(join(home.path, ".cache", "rowbly"))).toEqual(["pi-catalog.json"]);
    expect(JSON.parse(await readFile(piCatalogFile(ctx()), "utf8"))).toMatchObject({
      version: 1,
      models: catalog.models,
    });
  });

  it("reads stale when the mtime of auth.json changes", async () => {
    await touch("auth.json", 1000);
    await write();
    await touch("auth.json", 2000);
    expect(await readPiCatalog(ctx(), options)).toEqual({ ...catalog, fresh: false });
  });

  it("reads stale when the mtime of models.json changes", async () => {
    await touch("models.json", 1000);
    await write();
    await touch("models.json", 2000);
    expect((await readPiCatalog(ctx(), options))?.fresh).toBe(false);
  });

  it("reads stale when auth.json or models.json appears", async () => {
    await write();
    await touch("auth.json", 1000);
    expect((await readPiCatalog(ctx(), options))?.fresh).toBe(false);
    await write();
    await touch("models.json", 1000);
    expect((await readPiCatalog(ctx(), options))?.fresh).toBe(false);
  });

  it("reads stale when auth.json or models.json goes away", async () => {
    await touch("auth.json", 1000);
    await touch("models.json", 1000);
    await write();
    await rm(agentFile("auth.json"));
    expect((await readPiCatalog(ctx(), options))?.fresh).toBe(false);
    await write();
    await rm(agentFile("models.json"));
    expect((await readPiCatalog(ctx(), options))?.fresh).toBe(false);
  });

  it("reads stale when the Rowbly version changes", async () => {
    await write("0.0.1-old");
    expect((await readPiCatalog(ctx(), options))?.fresh).toBe(false);
    expect((await readPiCatalog(ctx(), { ...options, version: "0.0.1-old" }))?.fresh).toBe(true);
  });

  it("uses the agent folder of PI_CODING_AGENT_DIR for the key", async () => {
    const env = { PI_CODING_AGENT_DIR: join(home.path, "custom") };
    await writePiCatalog(catalog, await piCatalogKey(ctx(), { env }), ctx());
    await mkdir(join(home.path, "custom"));
    await writeFile(join(home.path, "custom", "auth.json"), "{}");
    expect((await readPiCatalog(ctx(), { env }))?.fresh).toBe(false);
  });

  it("reads a missing, corrupt or wrong-format file as missing, without an error", async () => {
    expect(await readPiCatalog(ctx(), options)).toBeUndefined();
    await mkdir(join(home.path, ".cache", "rowbly"), { recursive: true });
    const file = piCatalogFile(ctx());
    const key = await piCatalogKey(ctx(), options);
    const bad = [
      "{not json",
      "null",
      "[]",
      JSON.stringify({ version: 2, key, ...catalog }),
      JSON.stringify({ version: 1, ...catalog }),
      JSON.stringify({ version: 1, key, models: "x", providers: [] }),
      JSON.stringify({ version: 1, key, models: [{ provider: "acme" }], providers: [] }),
      JSON.stringify({ version: 1, key, models: [], providers: [{ id: "acme", methods: [], configured: "yes" }] }),
    ];
    for (const content of bad) {
      await writeFile(file, content);
      await expect(readPiCatalog(ctx(), options)).resolves.toBeUndefined();
    }
  });

  it("deletes the file, and a missing file is not an error", async () => {
    await write();
    await deletePiCatalog(ctx());
    expect(await readPiCatalog(ctx(), options)).toBeUndefined();
    await expect(deletePiCatalog(ctx())).resolves.toBeUndefined();
  });
});
