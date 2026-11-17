import { describe, expect, it } from "vitest";
import { isPiWorkerData, isPiWorkerReply, PI_WORKER_DATA } from "./pi-worker-protocol.js";

describe("pi worker protocol", () => {
  it("knows the worker data of the Pi worker", () => {
    expect(isPiWorkerData(PI_WORKER_DATA)).toBe(true);
    expect(isPiWorkerData(undefined)).toBe(false);
    expect(isPiWorkerData(null)).toBe(false);
    expect(isPiWorkerData({ rowblyPiWorker: "yes" })).toBe(false);
  });

  it("knows a reply by its id and its ok flag", () => {
    expect(isPiWorkerReply({ id: 1, ok: true, data: [] })).toBe(true);
    expect(isPiWorkerReply({ id: 1, ok: false, message: "failed" })).toBe(true);
    expect(isPiWorkerReply({ id: "1", ok: true })).toBe(false);
    expect(isPiWorkerReply({ id: 1 })).toBe(false);
    expect(isPiWorkerReply("reply")).toBe(false);
  });
});
