import { afterEach, expect, it, vi } from "vitest";
import * as auth from "../../services/agentAuth/agentAuth.js";
import { runCli } from "../testCli/testCli.js";

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});
it("rejects non-TTY login before the runtime opens", async () => {
  const runtime = vi.spyOn(auth, "authRuntime");
  const result = await runCli(["--json", "auth", "login", "openai"]);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("interactive terminal");
  expect(result.stderr).toContain("without --json");
  expect(runtime).not.toHaveBeenCalled();
});
