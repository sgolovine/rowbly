import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn() }));
vi.mock("node:child_process", () => mocks);
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
beforeEach(() => {
  vi.resetModules();
  mocks.spawn.mockReset();
  mocks.execFile.mockReset();
  vi.stubEnv("WAYLAND_DISPLAY", "");
});
function child() {
  const process = Object.assign(new EventEmitter(), { stdio: [null, null, null, new PassThrough()], kill: vi.fn() });
  mocks.spawn.mockReturnValue(process);
  return process;
}
async function response(value: unknown, code = 0) {
  const process = child();
  const { readClipboardImage } = await import("./clipboard.js");
  const result = readClipboardImage();
  (process.stdio[3] as PassThrough).write(typeof value === "string" ? value : JSON.stringify(value));
  process.emit("close", code);
  return { result: await result, process };
}
describe("isolated clipboard reader", () => {
  it("decodes PNG output and uses an isolated module helper", async () => {
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const { result, process } = await response({ base64: bytes.toString("base64") });
    expect(result).toEqual({ bytes, type: "image/png" });
    expect(mocks.spawn.mock.calls[0]?.[1]).toContain("--eval");
    expect(mocks.spawn.mock.calls[0]?.[2].env.NODE_OPTIONS).toBe("");
    expect(process.kill).toHaveBeenCalledWith("SIGKILL");
  });
  it.each(["unsupported", "no-display", "no-image", "too-large"])("preserves %s", async (reason) => {
    expect((await response({ reason })).result).toEqual({ reason });
  });
  it("contains crashes and malformed output", async () => {
    expect((await response("invalid", 139)).result).toEqual({ reason: "unsupported" });
    expect((await response("invalid")).result).toEqual({ reason: "unsupported" });
  });
  it("kills a hung native process after three seconds", async () => {
    vi.useFakeTimers();
    const process = child();
    const { readClipboardImage } = await import("./clipboard.js");
    const result = readClipboardImage();
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toEqual({ reason: "timeout" });
    expect(process.kill).toHaveBeenCalledWith("SIGKILL");
  });
  it("bounds native output", async () => {
    const process = child();
    const { readClipboardImage } = await import("./clipboard.js");
    const result = readClipboardImage();
    (process.stdio[3] as PassThrough).write(Buffer.alloc(15 * 1024 * 1024));
    expect(await result).toEqual({ reason: "too-large" });
  });
  it("falls back to wl-paste and shares the original deadline", async () => {
    vi.useFakeTimers();
    vi.stubEnv("WAYLAND_DISPLAY", "wayland-0");
    const process = child();
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    mocks.execFile.mockImplementation((_file, args, _options, callback) => {
      callback(null, args[0] === "--list-types" ? Buffer.from("text/plain\nimage/png\n") : bytes);
    });
    const { readClipboardImage } = await import("./clipboard.js");
    const result = readClipboardImage();
    await vi.advanceTimersByTimeAsync(2500);
    (process.stdio[3] as PassThrough).write(JSON.stringify({ reason: "no-display" }));
    process.emit("close", 0);
    expect(await result).toEqual({ bytes, type: "image/png" });
    expect(mocks.execFile.mock.calls.every((call) => call[2].timeout === 500)).toBe(true);
    expect(mocks.execFile.mock.calls[1]?.[2].maxBuffer).toBe(10 * 1024 * 1024);
  });
  it("reports unavailable wl-clipboard with a file fallback", async () => {
    vi.stubEnv("WAYLAND_DISPLAY", "wayland-0");
    mocks.execFile.mockImplementation((_file, _args, _options, callback) =>
      callback({ code: "ENOENT" }, Buffer.alloc(0)),
    );
    expect((await response({ reason: "unsupported" })).result).toEqual({ reason: "unsupported" });
    const { clipboardFailure } = await import("./clipboard.js");
    expect(clipboardFailure("unsupported", "ROW-01").hint).toContain("wl-clipboard");
    expect(clipboardFailure("unsupported", "ROW-01").hint).toContain("rowbly add-attachment ROW-01");
  });
});
