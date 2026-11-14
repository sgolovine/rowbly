import { chmod, lstat, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { readConfig } from "../config/config.js";
import { ConflictError, NotFoundError, ValidationError } from "../errors/errors.js";
import { pathExists, pathOccupied } from "../files/files.js";
import { useTempDir, useTestProject } from "../test-project/test-project.js";
import type { ServiceContext } from "../workspace/workspace.js";
import { bundledSkills, installSkill, listSkills, removeSkill } from "./skill.js";

async function writeSkill(dir: string, name: string): Promise<void> {
  await mkdir(join(dir, name, "references"), { recursive: true });
  await writeFile(join(dir, name, "SKILL.md"), `---\nname: ${name}\n---\n`);
  await writeFile(join(dir, name, "references", "notes.md"), "notes");
}

const removeFolder = (path: string) => rm(path, { recursive: true });

describe("skill service", () => {
  const project = useTestProject();
  const fixture = useTempDir();
  let ctx: ServiceContext;
  const at = (path: string) => join(project.paths.root, path);
  const skills = async () => (await readConfig(project.paths)).skills;

  beforeEach(async () => {
    await writeSkill(fixture.path, "alpha");
    await writeSkill(fixture.path, "beta");
    await writeFile(join(fixture.path, "rowbly-reference.md"), "shared");
    await mkdir(join(fixture.path, "not-a-skill"));
    ctx = { ...project.ctx, skillsDir: fixture.path };
  });

  describe("bundledSkills", () => {
    it("lists only the folders that have a SKILL.md", async () => {
      expect(await bundledSkills(ctx)).toEqual({ dir: fixture.path, names: ["alpha", "beta"] });
    });

    it("gives no skills for a folder that does not exist", async () => {
      expect((await bundledSkills({ skillsDir: join(fixture.path, "nope") })).names).toEqual([]);
    });

    it("finds the skills of the Rowbly package by default", async () => {
      expect((await bundledSkills()).names).toEqual(["develop", "refine", "review"]);
    });
  });

  describe("installSkill", () => {
    it("copies the skill for each harness and records it", async () => {
      const result = await installSkill({ name: "alpha", harnesses: ["cursor", "claude-code", "cursor"] }, ctx);
      expect(result).toEqual({
        name: "alpha",
        harnesses: [
          { harness: "cursor", path: at(".cursor/skills/alpha"), status: "installed" },
          { harness: "claude-code", path: at(".claude/skills/alpha"), status: "installed" },
        ],
      });
      expect(await readFile(at(".cursor/skills/alpha/references/notes.md"), "utf8")).toBe("notes");
      expect(await readFile(at(".claude/skills/alpha/SKILL.md"), "utf8")).toContain("name: alpha");
      expect(await skills()).toEqual([{ name: "alpha", harnesses: ["claude-code", "cursor"] }]);
      expect(await readdir(at(".cursor/skills"))).toEqual(["alpha"]);
    });

    it.each([
      ["claude-code", ".claude/skills"],
      ["codex", ".agents/skills"],
      ["gemini-cli", ".gemini/skills"],
      ["github-copilot", ".github/skills"],
      ["cursor", ".cursor/skills"],
    ])("installs for %s in %s", async (harness, dir) => {
      await installSkill({ name: "beta", harnesses: [harness] }, ctx);
      expect(await pathExists(at(`${dir}/beta/SKILL.md`))).toBe(true);
    });

    it("adds a harness to a tracked skill and keeps the other skills", async () => {
      await installSkill({ name: "alpha", harnesses: ["codex"] }, ctx);
      await installSkill({ name: "beta", harnesses: ["codex"] }, ctx);
      await installSkill({ name: "alpha", harnesses: ["cursor"] }, ctx);
      expect(await skills()).toEqual([
        { name: "beta", harnesses: ["codex"] },
        { name: "alpha", harnesses: ["codex", "cursor"] },
      ]);
    });

    it("reports a tracked skill that is present as already installed", async () => {
      await installSkill({ name: "alpha", harnesses: ["codex"] }, ctx);
      await writeFile(at(".agents/skills/alpha/local.md"), "edit");
      const result = await installSkill({ name: "alpha", harnesses: ["codex"] }, ctx);
      expect(result.harnesses[0]?.status).toBe("already-installed");
      expect(await readFile(at(".agents/skills/alpha/local.md"), "utf8")).toBe("edit");
    });

    it("copies a tracked skill again when its folder is missing", async () => {
      await installSkill({ name: "alpha", harnesses: ["codex"] }, ctx);
      await removeFolder(at(".agents/skills/alpha"));
      const result = await installSkill({ name: "alpha", harnesses: ["codex"] }, ctx);
      expect(result.harnesses[0]?.status).toBe("installed");
      expect(await pathExists(at(".agents/skills/alpha/SKILL.md"))).toBe(true);
    });

    it("copies a tracked skill again for one harness and leaves a good copy of another", async () => {
      await installSkill({ name: "alpha", harnesses: ["codex", "cursor"] }, ctx);
      await removeFolder(at(".agents/skills/alpha"));
      await writeFile(at(".cursor/skills/alpha/local.md"), "edit");
      const result = await installSkill({ name: "alpha", harnesses: ["codex", "cursor"] }, ctx);
      expect(result.harnesses.map((h) => [h.harness, h.status])).toEqual([
        ["codex", "installed"],
        ["cursor", "already-installed"],
      ]);
      expect(await readFile(at(".cursor/skills/alpha/local.md"), "utf8")).toBe("edit");
    });

    it("gives a conflict for a tracked folder that lost its SKILL.md, and changes nothing", async () => {
      await installSkill({ name: "alpha", harnesses: ["codex"] }, ctx);
      await rm(at(".agents/skills/alpha/SKILL.md"));
      await writeFile(at(".agents/skills/alpha/mine.md"), "mine");
      const error = await installSkill({ name: "alpha", harnesses: ["codex"] }, ctx).catch((e) => e);
      expect(error).toBeInstanceOf(ConflictError);
      expect(error.message).toContain(join(".agents", "skills", "alpha"));
      expect(error.hint).toMatch(/skill install/);
      expect(await readdir(at(".agents/skills/alpha"))).toEqual(["mine.md", "references"]);
    });

    it("gives a conflict for a file at the path of a tracked skill, and keeps the file", async () => {
      await installSkill({ name: "alpha", harnesses: ["codex"] }, ctx);
      await removeFolder(at(".agents/skills/alpha"));
      await writeFile(at(".agents/skills/alpha"), "mine");
      await expect(installSkill({ name: "alpha", harnesses: ["codex"] }, ctx)).rejects.toBeInstanceOf(ConflictError);
      expect(await readFile(at(".agents/skills/alpha"), "utf8")).toBe("mine");
    });

    it("writes nothing for any harness when one tracked copy is broken", async () => {
      await installSkill({ name: "alpha", harnesses: ["codex"] }, ctx);
      await rm(at(".agents/skills/alpha/SKILL.md"));
      const before = await project.read("rowbly.config.json");
      await expect(installSkill({ name: "alpha", harnesses: ["cursor", "codex"] }, ctx)).rejects.toBeInstanceOf(
        ConflictError,
      );
      expect(await pathExists(at(".cursor"))).toBe(false);
      expect(await project.read("rowbly.config.json")).toBe(before);
    });

    it("does not call a broken copy of a tracked harness shared", async () => {
      await installSkill({ name: "alpha", harnesses: ["claude-code"] }, ctx);
      await rm(at(".claude/skills/alpha/SKILL.md"));
      await mkdir(at(".agents"));
      await symlink("../.claude/skills", at(".agents/skills"));
      await expect(installSkill({ name: "alpha", harnesses: ["codex"] }, ctx)).rejects.toBeInstanceOf(ConflictError);
      expect(await skills()).toEqual([{ name: "alpha", harnesses: ["claude-code"] }]);
    });

    it("writes nothing when an untracked folder is in the way", async () => {
      await mkdir(at(".claude/skills/alpha"), { recursive: true });
      await writeFile(at(".claude/skills/alpha/mine.md"), "mine");
      const before = await project.read("rowbly.config.json");
      const error = await installSkill({ name: "alpha", harnesses: ["claude-code"] }, ctx).catch((e) => e);
      expect(error).toBeInstanceOf(ConflictError);
      expect(error.hint).toMatch(/skill install/);
      expect(await readdir(at(".claude/skills/alpha"))).toEqual(["mine.md"]);
      expect(await project.read("rowbly.config.json")).toBe(before);
    });

    it("checks each harness before it writes for any harness", async () => {
      await mkdir(at(".cursor/skills/alpha"), { recursive: true });
      const before = await project.read("rowbly.config.json");
      const error = await installSkill({ name: "alpha", harnesses: ["codex", "cursor"] }, ctx).catch((e) => e);
      expect(error).toBeInstanceOf(ConflictError);
      expect(error.details.conflicts).toEqual([join(".cursor", "skills", "alpha")]);
      expect(await pathExists(at(".agents"))).toBe(false);
      expect(await project.read("rowbly.config.json")).toBe(before);
    });

    it("counts a broken symlink as a conflict", async () => {
      await mkdir(at(".claude/skills"), { recursive: true });
      await symlink("missing", at(".claude/skills/alpha"));
      await expect(installSkill({ name: "alpha", harnesses: ["claude-code"] }, ctx)).rejects.toBeInstanceOf(
        ConflictError,
      );
      expect(await skills()).toBeUndefined();
    });

    it.each(["rowbly-reference.md", "../x", "not-a-skill", "nope"])("rejects the name %s", async (name) => {
      const error = await installSkill({ name, harnesses: ["codex"] }, ctx).catch((e) => e);
      expect(error).toBeInstanceOf(NotFoundError);
      expect(error.hint).toBe("Bundled skills: alpha, beta");
      expect(await pathExists(at(".agents"))).toBe(false);
    });

    it("rejects an unknown harness and an empty list of harnesses", async () => {
      const error = await installSkill({ name: "alpha", harnesses: ["codex", "vim"] }, ctx).catch((e) => e);
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.message).toBe("Unknown harness: vim");
      expect(error.hint).toContain("claude-code");
      expect(await pathExists(at(".agents"))).toBe(false);
      await expect(installSkill({ name: "alpha", harnesses: [] }, ctx)).rejects.toBeInstanceOf(ValidationError);
    });

    it("records a harness whose folder is a symlink to the folder of a tracked harness", async () => {
      await installSkill({ name: "alpha", harnesses: ["claude-code"] }, ctx);
      await mkdir(at(".agents"));
      await symlink("../.claude/skills", at(".agents/skills"));
      const result = await installSkill({ name: "alpha", harnesses: ["codex"] }, ctx);
      expect(result.harnesses[0]?.status).toBe("shared");
      expect(await skills()).toEqual([{ name: "alpha", harnesses: ["claude-code", "codex"] }]);
    });

    it("still reports a conflict through a symlinked folder when the other harness is not tracked", async () => {
      await mkdir(at(".claude/skills/alpha"), { recursive: true });
      await mkdir(at(".agents"));
      await symlink("../.claude/skills", at(".agents/skills"));
      await expect(installSkill({ name: "alpha", harnesses: ["codex"] }, ctx)).rejects.toBeInstanceOf(ConflictError);
    });

    it("copies one time when two harnesses of a run share a folder that does not exist yet", async () => {
      await mkdir(at(".claude"));
      await symlink(".claude", at(".agents"));
      const result = await installSkill({ name: "alpha", harnesses: ["codex", "claude-code"] }, ctx);
      expect(result.harnesses.map((h) => h.status)).toEqual(["installed", "shared"]);
      expect(await pathExists(at(".claude/skills/alpha/SKILL.md"))).toBe(true);
    });

    it("leaves the other skills of a shared folder intact", async () => {
      await mkdir(at(".agents/skills/theirs"), { recursive: true });
      await writeFile(at(".agents/skills/theirs/SKILL.md"), "theirs");
      await installSkill({ name: "alpha", harnesses: ["codex"] }, ctx);
      await removeSkill({ name: "alpha" }, ctx);
      expect(await readdir(at(".agents/skills"))).toEqual(["theirs"]);
      expect(await readFile(at(".agents/skills/theirs/SKILL.md"), "utf8")).toBe("theirs");
    });

    it("copies the target of a symlink, not the symlink", async () => {
      await writeFile(join(fixture.path, "outside.md"), "outside");
      await symlink("../../outside.md", join(fixture.path, "alpha", "references", "link.md"));
      await installSkill({ name: "alpha", harnesses: ["codex"] }, ctx);
      const copy = at(".agents/skills/alpha/references/link.md");
      expect((await lstat(copy)).isSymbolicLink()).toBe(false);
      expect(await readFile(copy, "utf8")).toBe("outside");
    });

    it("keeps the mode of a script", async () => {
      await writeFile(join(fixture.path, "alpha", "run.sh"), "#!/bin/sh\n");
      await chmod(join(fixture.path, "alpha", "run.sh"), 0o755);
      await installSkill({ name: "alpha", harnesses: ["codex"] }, ctx);
      expect((await lstat(at(".agents/skills/alpha/run.sh"))).mode & 0o111).not.toBe(0);
    });

    it("removes the folders of the run when a later copy fails", async () => {
      await mkdir(at(".cursor"));
      await symlink("missing", at(".cursor/skills"));
      const before = await project.read("rowbly.config.json");
      await expect(installSkill({ name: "alpha", harnesses: ["claude-code", "cursor"] }, ctx)).rejects.toBeInstanceOf(
        ConflictError,
      );
      expect(await pathExists(at(".claude"))).toBe(false);
      expect(await project.read("rowbly.config.json")).toBe(before);
    });

    it("leaves no temporary folder when a copy fails", async () => {
      await symlink("missing", join(fixture.path, "beta", "broken"));
      await mkdir(at(".agents/skills"), { recursive: true });
      await expect(installSkill({ name: "beta", harnesses: ["codex"] }, ctx)).rejects.toThrow();
      expect(await readdir(at(".agents/skills"))).toEqual([]);
      expect(await skills()).toBeUndefined();
    });
  });

  describe("listSkills", () => {
    it("gives nothing when no skill is installed", async () => {
      expect(await listSkills(ctx)).toEqual([]);
    });

    it("shows for each harness if the copy is there", async () => {
      await installSkill({ name: "alpha", harnesses: ["claude-code", "codex"] }, ctx);
      await removeFolder(at(".agents/skills/alpha"));
      expect(await listSkills(ctx)).toEqual([
        {
          name: "alpha",
          harnesses: [
            { harness: "claude-code", path: at(".claude/skills/alpha"), installed: true },
            { harness: "codex", path: at(".agents/skills/alpha"), installed: false },
          ],
        },
      ]);
    });
  });

  describe("removeSkill", () => {
    it("removes every tracked harness and drops the skills key", async () => {
      await installSkill({ name: "alpha", harnesses: ["claude-code", "cursor"] }, ctx);
      const result = await removeSkill({ name: "alpha" }, ctx);
      expect(result.harnesses.map((h) => [h.harness, h.status])).toEqual([
        ["claude-code", "removed"],
        ["cursor", "removed"],
      ]);
      expect(await pathOccupied(at(".claude/skills/alpha"))).toBe(false);
      expect(await pathOccupied(at(".cursor/skills/alpha"))).toBe(false);
      expect(await project.read("rowbly.config.json")).not.toContain("skills");
    });

    it("removes only the named harnesses", async () => {
      await installSkill({ name: "alpha", harnesses: ["claude-code", "cursor"] }, ctx);
      await installSkill({ name: "beta", harnesses: ["codex"] }, ctx);
      await removeSkill({ name: "alpha", harnesses: ["cursor"] }, ctx);
      expect(await pathExists(at(".claude/skills/alpha/SKILL.md"))).toBe(true);
      expect(await pathOccupied(at(".cursor/skills/alpha"))).toBe(false);
      expect(await skills()).toEqual([
        { name: "beta", harnesses: ["codex"] },
        { name: "alpha", harnesses: ["claude-code"] },
      ]);
    });

    it("keeps the factory section when it installs and removes a skill", async () => {
      const factory = {
        maxWorkers: 2,
        git: { push: true },
        checks: { items: [{ key: "test", command: "pnpm test" }] },
      };
      const config = JSON.parse(await project.read("rowbly.config.json"));
      await project.write("rowbly.config.json", JSON.stringify({ ...config, factory }, null, 2));
      await installSkill({ name: "alpha", harnesses: ["codex"] }, ctx);
      expect((await readConfig(project.paths)).factory).toEqual(factory);
      await removeSkill({ name: "alpha" }, ctx);
      expect((await readConfig(project.paths)).factory).toEqual(factory);
    });

    it("gives NotFoundError for a skill or a harness that is not tracked, and changes nothing", async () => {
      await expect(removeSkill({ name: "alpha" }, ctx)).rejects.toBeInstanceOf(NotFoundError);
      await installSkill({ name: "alpha", harnesses: ["codex"] }, ctx);
      await expect(removeSkill({ name: "alpha", harnesses: ["cursor"] }, ctx)).rejects.toBeInstanceOf(NotFoundError);
      await expect(removeSkill({ name: "alpha", harnesses: ["vim"] }, ctx)).rejects.toBeInstanceOf(ValidationError);
      await expect(removeSkill({ name: "alpha", harnesses: [] }, ctx)).rejects.toBeInstanceOf(ValidationError);
      expect(await pathExists(at(".agents/skills/alpha/SKILL.md"))).toBe(true);
      expect(await skills()).toEqual([{ name: "alpha", harnesses: ["codex"] }]);
    });

    it("does not touch a folder that Rowbly does not track", async () => {
      await installSkill({ name: "alpha", harnesses: ["claude-code"] }, ctx);
      await mkdir(at(".cursor/skills/alpha"), { recursive: true });
      await removeSkill({ name: "alpha" }, ctx);
      expect(await pathOccupied(at(".cursor/skills/alpha"))).toBe(true);
    });

    it("keeps a folder that another tracked harness uses through a symlink", async () => {
      await installSkill({ name: "alpha", harnesses: ["claude-code"] }, ctx);
      await mkdir(at(".agents"));
      await symlink("../.claude/skills", at(".agents/skills"));
      await installSkill({ name: "alpha", harnesses: ["codex"] }, ctx);

      const first = await removeSkill({ name: "alpha", harnesses: ["codex"] }, ctx);
      expect(first.harnesses[0]?.status).toBe("shared");
      expect(await pathExists(at(".claude/skills/alpha/SKILL.md"))).toBe(true);
      expect(await skills()).toEqual([{ name: "alpha", harnesses: ["claude-code"] }]);

      await removeSkill({ name: "alpha" }, ctx);
      expect(await pathOccupied(at(".claude/skills/alpha"))).toBe(false);
    });

    it("keeps a folder that another tracked harness uses through a symlink at the skill", async () => {
      await installSkill({ name: "alpha", harnesses: ["codex", "claude-code"] }, ctx);
      await removeFolder(at(".claude/skills/alpha"));
      await symlink("../../.agents/skills/alpha", at(".claude/skills/alpha"));

      const result = await removeSkill({ name: "alpha", harnesses: ["codex"] }, ctx);
      expect(result.harnesses).toEqual([{ harness: "codex", path: at(".agents/skills/alpha"), status: "shared" }]);
      expect(await readFile(at(".claude/skills/alpha/SKILL.md"), "utf8")).toContain("name: alpha");
      expect(await skills()).toEqual([{ name: "alpha", harnesses: ["claude-code"] }]);
    });

    it("removes only the link of a harness whose skill is a symlink to the folder of another harness", async () => {
      await installSkill({ name: "alpha", harnesses: ["codex", "claude-code"] }, ctx);
      await removeFolder(at(".claude/skills/alpha"));
      await symlink("../../.agents/skills/alpha", at(".claude/skills/alpha"));

      const result = await removeSkill({ name: "alpha", harnesses: ["claude-code"] }, ctx);
      expect(result.harnesses[0]?.status).toBe("removed");
      expect(await pathOccupied(at(".claude/skills/alpha"))).toBe(false);
      expect(await readFile(at(".agents/skills/alpha/SKILL.md"), "utf8")).toContain("name: alpha");
    });

    it("keeps a symlink at the skill that a remaining harness reaches through a symlinked folder", async () => {
      await installSkill({ name: "alpha", harnesses: ["claude-code"] }, ctx);
      await removeFolder(at(".claude/skills/alpha"));
      await mkdir(at("elsewhere"));
      await writeFile(at("elsewhere/SKILL.md"), "elsewhere");
      await symlink("../../elsewhere", at(".claude/skills/alpha"));
      await mkdir(at(".agents"));
      await symlink("../.claude/skills", at(".agents/skills"));
      await installSkill({ name: "alpha", harnesses: ["codex"] }, ctx);

      const result = await removeSkill({ name: "alpha", harnesses: ["codex"] }, ctx);
      expect(result.harnesses[0]?.status).toBe("shared");
      expect((await lstat(at(".claude/skills/alpha"))).isSymbolicLink()).toBe(true);
    });

    it("deletes the real folder when no remaining harness resolves to it", async () => {
      await installSkill({ name: "alpha", harnesses: ["codex", "claude-code"] }, ctx);
      await removeFolder(at(".claude/skills/alpha"));
      await symlink("../../.agents/skills/alpha", at(".claude/skills/alpha"));
      await removeSkill({ name: "alpha" }, ctx);
      expect(await pathOccupied(at(".agents/skills/alpha"))).toBe(false);
      expect(await pathOccupied(at(".claude/skills/alpha"))).toBe(false);
    });

    it("untracks a skill whose folder is already missing", async () => {
      await installSkill({ name: "alpha", harnesses: ["codex"] }, ctx);
      await removeFolder(at(".agents"));
      const result = await removeSkill({ name: "alpha" }, ctx);
      expect(result.harnesses[0]?.status).toBe("missing");
      expect(await skills()).toBeUndefined();
    });

    it("untracks a skill when a file is in place of its parent folder", async () => {
      await installSkill({ name: "alpha", harnesses: ["codex"] }, ctx);
      await removeFolder(at(".agents"));
      await writeFile(at(".agents"), "");
      expect((await removeSkill({ name: "alpha" }, ctx)).harnesses[0]?.status).toBe("missing");
      expect(await pathExists(at(".agents"))).toBe(true);
    });

    it("removes a symlink at the skill path, not its target", async () => {
      await installSkill({ name: "alpha", harnesses: ["codex"] }, ctx);
      await removeFolder(at(".agents/skills/alpha"));
      await mkdir(at("elsewhere"));
      await writeFile(at("elsewhere/keep.md"), "keep");
      await symlink("../../elsewhere", at(".agents/skills/alpha"));
      await removeSkill({ name: "alpha" }, ctx);
      expect(await pathOccupied(at(".agents/skills/alpha"))).toBe(false);
      expect(await readFile(at("elsewhere/keep.md"), "utf8")).toBe("keep");
    });
  });
});
