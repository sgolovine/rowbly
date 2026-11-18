import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ValidationError } from "../errors/errors.js";
import { useTempDir } from "../test-project/test-project.js";
import { devBuildId, type LocalBuildDeps, localBuild, validateBuildId } from "./local-build.js";

const BYTES = Buffer.from("fixed package bytes");
const HASH = createHash("sha256").update(BYTES).digest("hex").slice(0, 12);

describe("local build", () => {
  const dir = useTempDir();

  function deps(overrides: Partial<LocalBuildDeps> = {}): LocalBuildDeps {
    return {
      packageDir: async () => dir.path,
      modulePath: join(dir.path, "dist", "cli.js"),
      version: "0.18.0",
      pack: vi.fn(async () => BYTES),
      ...overrides,
    };
  }

  it("gives a released build with the version as id and does not pack", async () => {
    const build = deps();
    await expect(localBuild(build)).resolves.toEqual({ id: "0.18.0", version: "0.18.0", released: true });
    expect(build.pack).not.toHaveBeenCalled();
  });

  it("gives a released build for a package with only src/config/prompts", async () => {
    await writeFile(join(dir.path, ".git"), "gitdir: elsewhere\n");
    await mkdir(join(dir.path, "src", "config", "prompts"), { recursive: true });
    await writeFile(join(dir.path, "src", "config", "prompts", "SYSTEM.md"), "");
    await mkdir(join(dir.path, "dist"));
    await writeFile(join(dir.path, "dist", "cli.js"), "");

    const build = deps();

    await expect(localBuild(build)).resolves.toEqual({ id: "0.18.0", version: "0.18.0", released: true });
    expect(build.pack).not.toHaveBeenCalled();
  });

  it("gives an unreleased build in a source checkout with the hash of the package", async () => {
    await mkdir(join(dir.path, "src"));
    await writeFile(join(dir.path, "src", "cli.ts"), "");
    await mkdir(join(dir.path, "dist"));
    await writeFile(join(dir.path, "dist", "cli.js"), "");

    const build = await localBuild(deps());

    expect(build).toMatchObject({ id: `0.18.0-dev-${HASH}`, version: "0.18.0", released: false });
    expect(build.id).toBe(devBuildId("0.18.0", BYTES));
    expect(await build.pack?.()).toEqual(BYTES);
  });

  it("gives an unreleased build when the module runs from src/", async () => {
    await mkdir(join(dir.path, "dist"));
    await writeFile(join(dir.path, "dist", "cli.js"), "");

    const build = await localBuild(deps({ modulePath: join(dir.path, "src", "services", "x.ts") }));

    expect(build.released).toBe(false);
  });

  it("refuses an unreleased build without dist/cli.js", async () => {
    await mkdir(join(dir.path, "src"));
    await writeFile(join(dir.path, "src", "cli.ts"), "");
    const error = await localBuild(deps()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({ hint: "Run pnpm build" });
  });

  it("refuses a version with + and other unsafe characters", async () => {
    await expect(localBuild(deps({ version: "1.0.0+build.5" }))).rejects.toBeInstanceOf(ValidationError);
    expect(() => validateBuildId("1.0.0 x")).toThrow(ValidationError);
    expect(() => validateBuildId("../x/y")).toThrow(ValidationError);
    expect(() => validateBuildId("0.18.0-dev-abcdef012345")).not.toThrow();
  });
});
