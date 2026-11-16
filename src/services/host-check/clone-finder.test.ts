import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it } from "vitest";
import { answerFor, type FakeHostAnswers, output } from "../test-project/fake-host-answers.js";
import { createFakeHostTransport } from "../test-project/fake-host-transport.js";
import { useTestProject } from "../test-project/test-project.js";
import { RC_FILE } from "../user-rc/user-rc.js";
import { hostCloneFinder } from "./clone-finder.js";

const exec = promisify(execFile);
const REPO = "/srv/rowbly";

describe("hostCloneFinder", () => {
  const p = useTestProject();
  const find = (answers: FakeHostAnswers) =>
    hostCloneFinder(p.ctx)(
      createFakeHostTransport({ bytes: (command) => answerFor(answers, command) }),
      "mini",
      p.paths.root,
    );
  const writeHost = (projects: unknown[]) =>
    writeFile(
      join(p.ctx.home as string, RC_FILE),
      JSON.stringify({ hosts: [{ id: "mini", ssh: "u@mini", maxWorkers: 1, enabled: true, projects }] }),
    );

  beforeEach(async () => {
    await exec("git", ["init", "-q", p.paths.root]);
    await exec("git", ["-C", p.paths.root, "remote", "add", "origin", "git@github.com:o/r.git"]);
  });

  it("gives undefined when the host does not use the Project", async () => {
    await writeHost([]);

    await expect(find({})).resolves.toBeUndefined();
  });

  it("gives the path of a clone of the same repository, and undefined for a missing folder", async () => {
    await writeHost([{ root: p.paths.root, path: REPO, managed: false }]);
    const clone = {
      test: output(0, ""),
      "git-rev-parse": output(0, "true\n"),
      "git-remote": output(0, "ssh://git@github.com/o/r\n"),
    };

    await expect(find(clone)).resolves.toBe(REPO);
    await expect(find({ test: output(1, "") })).resolves.toBeUndefined();
  });

  it("gives VALIDATION when the folder is not a Git clone", async () => {
    await writeHost([{ root: p.paths.root, path: REPO, managed: false }]);

    await expect(find({ test: output(0, ""), "git-rev-parse": output(128, "") })).rejects.toMatchObject({
      code: "VALIDATION",
      message: `The folder ${REPO} on the host is not a Git clone.`,
      hint: "Run rowbly host unuse mini, then rowbly host use mini.",
    });
  });
});
