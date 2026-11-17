import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { useTempDir } from "../test-project/test-project.js";
import { withFileLock } from "./file-lock.js";

const run = promisify(execFile);

describe("withFileLock", () => {
  const dir = useTempDir();

  it("holds the lock while the action runs and releases it after", async () => {
    const path = join(dir.path, "a.lock");
    const result = await withFileLock(path, async () => {
      await expect(run("flock", ["-n", path, "true"])).rejects.toMatchObject({ code: 1 });
      return 7;
    });
    expect(result).toBe(7);
    await expect(run("flock", ["-n", path, "true"])).resolves.toBeDefined();
  });

  it("gives a ConflictError with the label after a timeout", async () => {
    const path = join(dir.path, "b.lock");
    let called = false;
    await withFileLock(path, async () => {
      await expect(
        withFileLock(
          path,
          async () => {
            called = true;
          },
          { waitSeconds: 0.01, label: "Outbox lock" },
        ),
      ).rejects.toMatchObject({ code: "CONFLICT", message: "Outbox lock is unavailable" });
    });
    expect(called).toBe(false);
  });
});
