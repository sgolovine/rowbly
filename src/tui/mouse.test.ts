import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { type MouseEvent, MouseStdin } from "./mouse.js";

class FakeTty extends EventEmitter {
  setRawMode = vi.fn();
  setEncoding = vi.fn();
  pause = vi.fn();
  resume = vi.fn();
}

describe("MouseStdin", () => {
  it("resumes the terminal when raw mode comes back on, after Ink turns it off between two modals", () => {
    const tty = new FakeTty();
    const stdin = new MouseStdin(tty as unknown as NodeJS.ReadStream);
    stdin.setRawMode(true);
    stdin.setRawMode(false);
    expect(tty.pause).toHaveBeenCalledTimes(1);
    tty.resume.mockClear();
    stdin.setRawMode(true);
    expect(tty.resume).toHaveBeenCalledTimes(1);
  });

  it("takes mouse reports out of the input and passes the other keys on", () => {
    const tty = new FakeTty();
    const stdin = new MouseStdin(tty as unknown as NodeJS.ReadStream);
    const events: MouseEvent[] = [];
    stdin.mouse.on("mouse", (event: MouseEvent) => events.push(event));
    stdin.setRawMode(true);
    tty.emit("data", "a\u001B[<0;5;7Mb");
    expect(events).toEqual([{ kind: "press", x: 4, y: 6 }]);
    expect(stdin.read()).toBe("ab");
  });
});
