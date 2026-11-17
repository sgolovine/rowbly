import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn() }));
vi.mock("node:child_process", () => mocks);
const platform = process.platform;
function setPlatform(value: string) {
  Object.defineProperty(process, "platform", { value, configurable: true });
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  setPlatform(platform);
});
beforeEach(() => {
  vi.resetModules();
  mocks.spawn.mockReset();
  mocks.execFile.mockReset();
  vi.stubEnv("WAYLAND_DISPLAY", "");
  vi.stubEnv("DISPLAY", "");
  setPlatform("linux");
});
function child() {
  const process = Object.assign(new EventEmitter(), { stdio: [null, null, null, new PassThrough()], kill: vi.fn() });
  mocks.spawn.mockReturnValue(process);
  return process;
}
/** Answers each command with the output for its file and arguments. A missing key fails with ENOENT. */
function commands(outputs: Record<string, string | Buffer | { code: string }>) {
  mocks.execFile.mockImplementation((file: string, args: string[], _options, callback) => {
    const output = outputs[[file, ...args].join(" ")] ?? { code: "ENOENT" };
    if (typeof output === "object" && !Buffer.isBuffer(output)) {
      callback(output, Buffer.alloc(0));
    } else {
      callback(null, Buffer.from(output));
    }
  });
}
async function response(value: unknown, code = 0) {
  const process = child();
  const calls = mocks.spawn.mock.calls.length;
  const { readClipboard } = await import("./clipboard.js");
  const result = readClipboard();
  await vi.waitFor(() => expect(mocks.spawn.mock.calls.length).toBe(calls + 1));
  (process.stdio[3] as PassThrough).write(typeof value === "string" ? value : JSON.stringify(value));
  process.emit("close", code);
  return { result: await result, process };
}
const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
describe("isolated clipboard reader", () => {
  it("decodes PNG output and uses an isolated module helper", async () => {
    const { result, process } = await response({ base64: pngBytes.toString("base64") });
    expect(result).toEqual({ kind: "image", bytes: pngBytes, type: "image/png" });
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
    const { readClipboard } = await import("./clipboard.js");
    const result = readClipboard();
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toEqual({ reason: "timeout" });
    expect(process.kill).toHaveBeenCalledWith("SIGKILL");
  });
  it("bounds native output", async () => {
    const process = child();
    const { readClipboard } = await import("./clipboard.js");
    const result = readClipboard();
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalled());
    (process.stdio[3] as PassThrough).write(Buffer.alloc(15 * 1024 * 1024));
    expect(await result).toEqual({ reason: "too-large" });
  });
  it("falls back to wl-paste and shares the original deadline", async () => {
    vi.useFakeTimers();
    vi.stubEnv("WAYLAND_DISPLAY", "wayland-0");
    const process = child();
    commands({ "wl-paste --list-types": "text/plain\nimage/png\n", "wl-paste --type image/png": pngBytes });
    const { readClipboard } = await import("./clipboard.js");
    const result = readClipboard();
    await vi.advanceTimersByTimeAsync(2500);
    (process.stdio[3] as PassThrough).write(JSON.stringify({ reason: "no-display" }));
    process.emit("close", 0);
    expect(await result).toEqual({ kind: "image", bytes: pngBytes, type: "image/png" });
    // The type list is the first step. The image read after the native helper gets the time that remains.
    expect(mocks.execFile.mock.calls[0]?.[2].timeout).toBe(3000);
    expect(mocks.execFile.mock.calls[1]?.[2].timeout).toBe(500);
    expect(mocks.execFile.mock.calls[1]?.[2].maxBuffer).toBe(10 * 1024 * 1024);
  });
  it("reports unavailable wl-clipboard with a file fallback", async () => {
    vi.stubEnv("WAYLAND_DISPLAY", "wayland-0");
    commands({});
    expect((await response({ reason: "unsupported" })).result).toEqual({ reason: "unsupported" });
    const { clipboardFailure } = await import("./clipboard.js");
    expect(clipboardFailure("unsupported", "ROW-01").hint).toContain("wl-clipboard");
    expect(clipboardFailure("unsupported", "ROW-01").hint).toContain("rowbly add-attachment ROW-01");
  });
});

describe("copied files", () => {
  it("parses URI lists", async () => {
    const { parseUriList } = await import("./clipboard-files.js");
    expect(
      parseUriList(
        "# comment\r\nfile:///tmp/a%20b/report.pdf\r\n\r\nhttps://example.com/x\nsmb://host/y\nfile:///c.txt\n",
      ),
    ).toEqual(["/tmp/a b/report.pdf", "/c.txt"]);
    expect(parseUriList("")).toEqual([]);
  });
  it("reads a file list on Wayland before the native helper", async () => {
    vi.stubEnv("WAYLAND_DISPLAY", "wayland-0");
    commands({
      "wl-paste --list-types": "text/uri-list\nimage/png\n",
      "wl-paste --type text/uri-list": "file:///tmp/a%20b/report.pdf\n",
    });
    const { readClipboard } = await import("./clipboard.js");
    expect(await readClipboard()).toEqual({ kind: "file", path: "/tmp/a b/report.pdf" });
    // The file wins over the image, so the native helper does not start.
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.execFile.mock.calls[1]?.[2].killSignal).toBe("SIGKILL");
    expect(mocks.execFile.mock.calls[1]?.[2].maxBuffer).toBe(64 * 1024);
  });
  it("reads the GNOME file list type without its first line", async () => {
    vi.stubEnv("WAYLAND_DISPLAY", "wayland-0");
    commands({
      "wl-paste --list-types": "x-special/gnome-copied-files\n",
      "wl-paste --type x-special/gnome-copied-files": "copy\nfile:///home/u/notes.txt",
    });
    const { readClipboard } = await import("./clipboard.js");
    expect(await readClipboard()).toEqual({ kind: "file", path: "/home/u/notes.txt" });
  });
  it("uses xclip on X11 and gives the file-list command the remaining time", async () => {
    vi.useFakeTimers();
    vi.stubEnv("DISPLAY", ":0");
    const callbacks: Array<(error: unknown, stdout: Buffer) => void> = [];
    mocks.execFile.mockImplementation((_file, _args, _options, callback) => callbacks.push(callback));
    const { readClipboard } = await import("./clipboard.js");
    const result = readClipboard();
    await vi.advanceTimersByTimeAsync(1000);
    callbacks[0]?.(null, Buffer.from("TARGETS\ntext/uri-list\nimage/png\n"));
    await vi.advanceTimersByTimeAsync(0);
    expect(callbacks).toHaveLength(2);
    callbacks[1]?.(null, Buffer.from("file:///tmp/x.pdf\n"));
    expect(await result).toEqual({ kind: "file", path: "/tmp/x.pdf" });
    expect(mocks.execFile.mock.calls.map((call) => [call[0], ...call[1]].join(" "))).toEqual([
      "xclip -selection clipboard -t TARGETS -o",
      "xclip -selection clipboard -t text/uri-list -o",
    ]);
    expect(mocks.execFile.mock.calls[0]?.[2].timeout).toBe(3000);
    expect(mocks.execFile.mock.calls[1]?.[2].timeout).toBe(2000);
  });
  it("continues with the image read when the file-list command is missing", async () => {
    vi.stubEnv("DISPLAY", ":0");
    commands({});
    const { result } = await response({ base64: pngBytes.toString("base64") });
    expect(result).toEqual({ kind: "image", bytes: pngBytes, type: "image/png" });
  });
  it("uses osascript on macOS", async () => {
    setPlatform("darwin");
    commands({ "osascript -e POSIX path of (the clipboard as «class furl»)": "/Users/u/report.pdf\n" });
    const { readClipboard } = await import("./clipboard.js");
    expect(await readClipboard()).toEqual({ kind: "file", path: "/Users/u/report.pdf" });
    expect(mocks.execFile.mock.calls[0]?.[0]).toBe("osascript");
    expect(mocks.execFile.mock.calls[0]?.[1]).toEqual(["-e", "POSIX path of (the clipboard as «class furl»)"]);
  });
  it("continues with the image read when osascript finds no file", async () => {
    setPlatform("darwin");
    commands({ "osascript -e POSIX path of (the clipboard as «class furl»)": { code: "1" } });
    expect((await response({ reason: "no-image" })).result).toEqual({ reason: "no-image" });
  });
  it("uses PowerShell on Windows", async () => {
    setPlatform("win32");
    mocks.execFile.mockImplementation((_file, _args, _options, callback) =>
      callback(null, Buffer.from("C:\\Users\\u\\notes.txt\r\n")),
    );
    const { readClipboard } = await import("./clipboard.js");
    expect(await readClipboard()).toEqual({ kind: "file", path: "C:\\Users\\u\\notes.txt" });
    expect(mocks.execFile.mock.calls[0]?.[0]).toBe("powershell");
    expect(mocks.execFile.mock.calls[0]?.[1]).toEqual([
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-Clipboard -Format FileDropList | ForEach-Object { $_.FullName }",
    ]);
  });
  it("rejects more than one file", async () => {
    vi.stubEnv("WAYLAND_DISPLAY", "wayland-0");
    commands({
      "wl-paste --list-types": "text/uri-list\n",
      "wl-paste --type text/uri-list": "file:///a.txt\nfile:///b.txt\n",
    });
    const { readClipboard, clipboardFailure } = await import("./clipboard.js");
    expect(await readClipboard()).toEqual({ reason: "multiple-files" });
    expect(clipboardFailure("multiple-files").message).toBe("The clipboard has more than one file; copy one file");
  });
});

describe("other image types on Wayland", () => {
  it.each([
    ["image/jpeg", "image/jpeg\nimage/gif\n"],
    ["image/gif", "image/gif\nimage/webp\n"],
    ["image/webp", "text/plain\nimage/webp\n"],
  ])("reads %s", async (type, types) => {
    vi.stubEnv("WAYLAND_DISPLAY", "wayland-0");
    const bytes = Buffer.from([1, 2, 3]);
    commands({ "wl-paste --list-types": types, [`wl-paste --type ${type}`]: bytes });
    const { result } = await response({ reason: "no-image" });
    expect(result).toEqual({ kind: "image", bytes, type });
  });
});

describe("failure messages", () => {
  it("names a file or an image and the command of the session", async () => {
    const { clipboardFailure } = await import("./clipboard.js");
    const failure = clipboardFailure("no-image", "ROW-01");
    expect(failure.message).toBe("No file or image on the clipboard");
    expect(failure.details).toEqual({ reason: "no-image" });
    expect(failure.hint).toContain("rowbly add-attachment ROW-01 <file>");
    expect(failure.hint).not.toContain("xclip");
    vi.stubEnv("DISPLAY", ":0");
    expect(clipboardFailure("no-image", "ROW-01").hint).toContain("xclip");
    vi.stubEnv("WAYLAND_DISPLAY", "wayland-0");
    expect(clipboardFailure("no-image", "ROW-01").hint).toContain("wl-clipboard");
  });
});
