import { describe, expect, it } from "vitest";
import { mapInOrder } from "./map-in-order.js";

describe("mapInOrder", () => {
  it("runs one action at a time, in order", async () => {
    const events: string[] = [];
    const result = await mapInOrder([1, 2, 3], async (n) => {
      events.push(`start ${n}`);
      await new Promise((resolve) => setTimeout(resolve, 4 - n));
      events.push(`end ${n}`);
      return n * 2;
    });

    expect(result).toEqual([2, 4, 6]);
    expect(events).toEqual(["start 1", "end 1", "start 2", "end 2", "start 3", "end 3"]);
  });

  it("gives an empty list for no items", async () => {
    expect(await mapInOrder([], async () => 1)).toEqual([]);
  });

  it("stops at the first failure", async () => {
    const seen: number[] = [];

    await expect(
      mapInOrder([1, 2, 3], async (n) => {
        seen.push(n);
        if (n === 2) {
          throw new Error("stop");
        }
        return n;
      }),
    ).rejects.toThrow("stop");
    expect(seen).toEqual([1, 2]);
  });
});
