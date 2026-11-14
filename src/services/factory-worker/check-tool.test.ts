import { describe, expect, it, vi } from "vitest";
import type { CheckJob } from "../check-queue/check-types.js";
import { checkLimits } from "../factory-settings/check-settings.js";
import { checkCall, createCheckTool, type RunCheck } from "./check-tool.js";
import { blockedCheck, workerShellEnv } from "./worker-env.js";

const checks =
  checkLimits({
    items: [
      { key: "test", command: "pnpm test", narrowCommand: "pnpm vitest related --run {files}", block: ["vitest"] },
      { key: "lint", command: "pnpm lint" },
    ],
  })?.items ?? [];

describe("run_check", () => {
  it("runs the narrow command with the shell-quoted files, and the full command without files", () => {
    expect(checkCall(checks, "/w", { check: "test", files: ["src/a.ts", "it's.ts"] })).toMatchObject({
      scope: "narrow",
      command: "pnpm vitest related --run 'src/a.ts' 'it'\\''s.ts'",
    });
    expect(checkCall(checks, "/w", { check: "test" })).toMatchObject({ scope: "full", command: "pnpm test" });
    expect(checkCall(checks, "/w", { check: "lint", files: ["a.ts"] })).toMatchObject({
      scope: "full",
      files: [],
      command: "pnpm lint",
    });
  });

  it("rejects an unknown check with the configured keys, and a file outside the worktree", () => {
    expect(() => checkCall(checks, "/w", { check: "build" })).toThrow(
      "Unknown check: build. Configured checks: test, lint",
    );
    expect(() => checkCall(checks, "/w", { check: "test", files: ["../x.ts"] })).toThrow("relative path");
    expect(() => checkCall(checks, "/w", { check: "test", files: ["/etc/passwd"] })).toThrow("relative path");
    expect(() => checkCall(checks, "/w", { check: "test", files: ["."] })).toThrow("relative path");
  });

  it("waits for the result, sends the progress and gives the status, exit code, output and log", async () => {
    const job = {
      status: "failed",
      exitCode: 1,
      scope: "full",
      head: "abc",
      startedAt: "2026-11-14T00:00:00.000Z",
      endedAt: "2026-11-14T00:00:12.000Z",
    } as CheckJob;
    const run: RunCheck = vi.fn(async (_call, _signal, onProgress) => {
      onProgress("queued, position 2");
      return { job, output: "FAIL", log: "/r/checks/j.log" };
    });
    const onUpdate = vi.fn();
    const tool = createCheckTool(checks, "/w", run);

    const result = await tool.execute("id", { check: "test" }, undefined, onUpdate);

    expect(onUpdate).toHaveBeenCalledWith({ content: [{ type: "text", text: "queued, position 2" }], details: {} });
    expect(result.content[0]?.text).toBe(
      "status: failed\nexitCode: 1\ndurationSeconds: 12\nscope: full\nhead: abc\nlog: /r/checks/j.log\noutput:\nFAIL",
    );
    expect(result.details).toMatchObject({ status: "failed", exitCode: 1, log: "/r/checks/j.log" });
  });
});

describe("worker shell", () => {
  it("rejects the command and the block texts of a check", () => {
    expect(blockedCheck(checks, "cd x && pnpm test")).toBe("test");
    expect(blockedCheck(checks, "npx vitest run")).toBe("test");
    expect(blockedCheck(checks, "pnpm lint --fix")).toBe("lint");
    expect(blockedCheck(checks, "pnpm build")).toBeUndefined();
    expect(blockedCheck([], "pnpm test")).toBeUndefined();
  });

  it("puts the shim first on the PATH", () => {
    expect(workerShellEnv({ root: "/r", shim: "/r/bin/rowbly" }, { PATH: "/usr/bin" })).toEqual({
      PATH: "/r/bin:/usr/bin",
      ROWBLY_ROOT: "/r",
      ROWBLY_CLI: "/r/bin/rowbly",
    });
  });
});
