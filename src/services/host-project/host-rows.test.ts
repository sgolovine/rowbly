import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTempDir, useTestProject } from "../test-project/test-project.js";
import { RC_FILE } from "../user-rc/user-rc.js";
import { hostRows } from "./host-rows.js";

describe("host rows", () => {
  const p = useTestProject();
  const outside = useTempDir();
  const rcFile = () => join(p.ctx.home as string, RC_FILE);
  const lastCheck = { at: "2026-11-16T10:00:00.000Z", ready: false, failed: ["gh"] };

  const writeHosts = (root: string) =>
    writeFile(
      rcFile(),
      JSON.stringify({
        hosts: [
          {
            id: "mini",
            ssh: "user@mini.lan",
            maxWorkers: 2,
            enabled: true,
            projects: [{ root, path: "rowbly", managed: true }],
            lastCheck,
          },
          {
            id: "box",
            ssh: "box",
            maxWorkers: 1,
            enabled: false,
            projects: [{ root: "/other", path: "x", managed: false }],
          },
        ],
      }),
    );

  it("gives an empty list without hosts", async () => {
    expect(await hostRows(p.ctx)).toEqual([]);
  });

  it("gives each host in file order with its use by the current Project and its last check", async () => {
    await writeHosts(p.paths.root);

    expect(await hostRows(p.ctx)).toEqual([
      {
        host: { id: "mini", ssh: "user@mini.lan", maxWorkers: 2, enabled: true },
        usedByProject: true,
        lastCheck,
      },
      { host: { id: "box", ssh: "box", maxWorkers: 1, enabled: false }, usedByProject: false, lastCheck: null },
    ]);
  });

  it("gives usedByProject false for each host outside a Project", async () => {
    await writeHosts(p.paths.root);

    const rows = await hostRows({ ...p.ctx, cwd: outside.path });

    expect(rows.map((row) => row.usedByProject)).toEqual([false, false]);
  });

  it("gives VALIDATION for an invalid file and keeps the bytes", async () => {
    const text = JSON.stringify({ hosts: [{ id: "mini", ssh: "u", maxWorkers: 1, enabled: true, lastCheck: 1 }] });
    await writeFile(rcFile(), text);

    await expect(hostRows(p.ctx)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await readFile(rcFile(), "utf8")).toBe(text);
  });
});
