import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { newOwner, type Owner } from "../factory-ownership/ownership-lock.js";
import { useTempDir } from "../test-project/test-project.js";
import { slotPaths } from "./host-agent-paths.js";
import { acquireSlot, readSlotLimit, releaseSlot, slotUsage, writeSlotLimit } from "./host-slots.js";

/** An owner with a process that does not exist. */
async function deadOwner(): Promise<Owner> {
  return { ...(await newOwner()), pid: 2 ** 22 + 12345, processIdentity: "boot:1" };
}

describe("host slots", () => {
  const home = useTempDir();
  const options = () => ({ home: home.path });

  it("writes the machine limit with mode 0600 in a folder with mode 0700, and the last value wins", async () => {
    await writeSlotLimit(3, home.path);
    await writeSlotLimit(2, home.path);
    const paths = slotPaths(home.path);
    expect(JSON.parse(await readFile(paths.limit, "utf8"))).toEqual({ maxWorkers: 2 });
    expect((await stat(paths.limit)).mode & 0o777).toBe(0o600);
    expect((await stat(paths.dir)).mode & 0o777).toBe(0o700);
    expect(await readSlotLimit(home.path)).toBe(2);
  });

  it("refuses a bad limit, and a missing limit gives 0", async () => {
    for (const value of [0, -1, 1.5, Number.NaN]) {
      await expect(writeSlotLimit(value, home.path)).rejects.toMatchObject({ code: "VALIDATION" });
    }
    expect(await readSlotLimit(home.path)).toBe(0);
  });

  it("gives 2 slots to two Projects and refuses the third with HOST_NO_FREE_SLOT", async () => {
    await writeSlotLimit(2, home.path);
    const a = await newOwner();
    const b = { ...(await newOwner()) };

    expect(await acquireSlot({ projectId: "p1", threadId: "t1" }, a, options())).toEqual({ used: 1, max: 2 });
    expect(await acquireSlot({ projectId: "p2", threadId: "t1" }, b, options())).toEqual({ used: 2, max: 2 });
    await expect(acquireSlot({ projectId: "p1", threadId: "t2" }, a, options())).rejects.toMatchObject({
      code: "HOST_NO_FREE_SLOT",
      details: { used: 2, max: 2 },
    });
    expect(await slotUsage(home.path)).toEqual({ used: 2, max: 2 });
    const file = join(slotPaths(home.path).dir, "p1--t1.json");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ projectId: "p1", threadId: "t1", owner: a });
  });

  it("removes the slot of a dead owner, and then a launch gets a slot", async () => {
    await writeSlotLimit(1, home.path);
    await acquireSlot({ projectId: "p1", threadId: "t1" }, await deadOwner(), options());
    const live = await newOwner();

    expect(await acquireSlot({ projectId: "p2", threadId: "t2" }, live, options())).toEqual({ used: 1, max: 1 });
    expect((await readdir(slotPaths(home.path).dir)).filter((f) => f.includes("--"))).toEqual(["p2--t2.json"]);
  });

  it("keeps a slot of an uncertain owner", async () => {
    await writeSlotLimit(1, home.path);
    const owner = await newOwner();
    await acquireSlot({ projectId: "p1", threadId: "t1" }, owner, options());

    await expect(
      acquireSlot({ projectId: "p2", threadId: "t2" }, owner, { ...options(), probe: async () => "uncertain" }),
    ).rejects.toMatchObject({ code: "HOST_NO_FREE_SLOT" });
  });

  it("releases a slot only for its owner", async () => {
    await writeSlotLimit(1, home.path);
    const owner = await newOwner();
    const key = { projectId: "p1", threadId: "t1" };
    await acquireSlot(key, owner, options());

    expect(await releaseSlot(key, "other", home.path)).toBe(false);
    expect(await releaseSlot(key, owner.token, home.path)).toBe(true);
    expect(await slotUsage(home.path)).toEqual({ used: 0, max: 1 });
  });

  it("ignores a slot file of a dead owner in a different file", async () => {
    await writeSlotLimit(1, home.path);
    await writeFile(join(slotPaths(home.path).dir, "notes.txt"), "x");
    expect(await acquireSlot({ projectId: "p1", threadId: "t1" }, await newOwner(), options())).toEqual({
      used: 1,
      max: 1,
    });
  });
});
