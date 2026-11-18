import * as fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newOwner, probeOwner, probeOwnerCached } from "./factory-ownership.js";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

/** The count of reads of `/proc/<pid>/stat` since the last clear. */
function statReads(pid: number): number {
  return vi.mocked(fs.readFile).mock.calls.filter(([path]) => path === `/proc/${pid}/stat`).length;
}

/** Each test starts at a new time, so that no cached result of an earlier test is fresh. */
const start = { time: Date.parse("2030-01-01T00:00:00.000Z") };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  start.time += 60_000;
  vi.setSystemTime(start.time);
  vi.mocked(fs.readFile).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe.skipIf(process.platform !== "linux")("probeOwnerCached", () => {
  it("does not read /proc/<pid>/stat again for the same owner within 5 s", async () => {
    const owner = await newOwner();
    vi.mocked(fs.readFile).mockClear();

    expect(await probeOwnerCached(owner)).toBe("alive");
    expect(await probeOwnerCached(owner)).toBe("alive");
    expect(statReads(owner.pid)).toBe(1);

    vi.setSystemTime(start.time + 5000);
    expect(await probeOwnerCached(owner)).toBe("alive");
    expect(statReads(owner.pid)).toBe(2);
  });

  it("reads the boot ID one time for each process", async () => {
    const owner = await newOwner();
    vi.mocked(fs.readFile).mockClear();

    await probeOwner(owner);
    await probeOwner(owner);
    expect(vi.mocked(fs.readFile).mock.calls.filter(([path]) => String(path).endsWith("boot_id"))).toHaveLength(0);
  });

  it("gives dead at once when the cached process exits", async () => {
    const owner = await newOwner();

    expect(await probeOwnerCached(owner)).toBe("alive");
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("no process"), { code: "ESRCH" });
    });
    expect(await probeOwnerCached(owner)).toBe("dead");
  });

  it("does not cache a different identity of the same PID", async () => {
    const owner = await newOwner();

    expect(await probeOwnerCached(owner)).toBe("alive");
    expect(await probeOwnerCached({ ...owner, processIdentity: "other-boot:1" })).toBe("dead");
  });

  it("does not change probeOwner, which the takeover and the recovery use", async () => {
    const owner = await newOwner();

    expect(await probeOwnerCached(owner)).toBe("alive");
    vi.mocked(fs.readFile).mockClear();
    expect(await probeOwner(owner)).toBe("alive");
    expect(await probeOwner(owner)).toBe("alive");
    expect(statReads(owner.pid)).toBe(2);
  });
});
