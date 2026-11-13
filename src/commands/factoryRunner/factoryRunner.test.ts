import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { useTestProject } from "../../services/testProject/testProject.js";
import { createCliShim } from "./factoryRunner.js";

const exec = promisify(execFile);
describe("exact CLI shim", () => {
  const project = useTestProject();
  it("preserves launch arguments and quoted paths, and rejects an empty non-TTY call", async () => {
    const entry = join(project.paths.root, "entry ' with spaces.mjs");
    await writeFile(
      entry,
      "console.log(JSON.stringify({ argv: process.argv.slice(2), execArgv: process.execArgv }));\n",
    );
    const shim = await createCliShim({ executable: process.execPath, entry, execArgv: ["--no-warnings"] }, project.ctx);
    const result = JSON.parse((await exec(shim, ["story", "value ' with spaces", "$(false)"])).stdout);
    expect(result).toEqual({ argv: ["story", "value ' with spaces", "$(false)"], execArgv: ["--no-warnings"] });
    await expect(exec(shim, [])).rejects.toMatchObject({ code: 1, stderr: "Rowbly factory CLI requires a command\n" });
  });
});
