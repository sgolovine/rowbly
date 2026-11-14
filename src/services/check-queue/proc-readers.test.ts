import { describe, expect, it, vi } from "vitest";
import { killGroup, readGroupRssMb, readMemAvailableMb, readStartTicks, spawnCheck } from "./proc-readers.js";

describe.runIf(process.platform === "linux")("proc readers", () => {
  it("reads the free memory of the machine", async () => {
    expect(await readMemAvailableMb()).toBeGreaterThan(0);
  });

  it("runs a check in its own process group, with its output and exit code", async () => {
    const child = spawnCheck('echo "$ROWBLY_TEST"; exit 3', {
      cwd: "/tmp",
      env: { ...process.env, ROWBLY_TEST: "hi" },
    });
    const output: string[] = [];
    child.onOutput((chunk) => output.push(chunk));

    expect(await child.exited).toBe(3);
    expect(output.join("")).toBe("hi\n");
  });

  it("reads the start ticks and the RSS of a group, and a group signal stops all of its processes", async () => {
    const child = spawnCheck("sleep 30 & sleep 30; wait", { cwd: "/tmp", env: process.env });
    const pid = child.pid as number;

    await vi.waitFor(async () => expect(await readGroupRssMb(pid)).toBeGreaterThan(0));
    expect(await readStartTicks(pid)).toMatch(/^\d+$/);

    killGroup(pid, "SIGTERM");

    expect(await child.exited).toBeNull();
    await vi.waitFor(async () => expect(await readGroupRssMb(pid)).toBe(0));
    expect(await readStartTicks(pid)).toBeUndefined();
    expect(() => killGroup(pid, "SIGKILL")).not.toThrow();
  });
});
