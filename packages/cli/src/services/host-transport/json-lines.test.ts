import { describe, expect, it } from "vitest";
import { HostProtocolError } from "./host-errors.js";
import { decodeChunk, EMPTY_DECODER, encodeFrame, parseFrame } from "./json-lines.js";

describe("json lines", () => {
  it("encodes a value with a newline in a string as one line", () => {
    const line = encodeFrame({ text: "a\nb" });
    expect(line.endsWith("\n")).toBe(true);
    expect(line.slice(0, -1)).not.toContain("\n");
    expect(parseFrame(line.slice(0, -1))).toEqual({ text: "a\nb" });
  });

  it("joins a frame that arrives in parts", () => {
    const first = decodeChunk(EMPTY_DECODER, '{"a":');
    expect(first.lines).toEqual([]);
    const second = decodeChunk(first.state, "1");
    expect(second.lines).toEqual([]);
    const third = decodeChunk(second.state, '}\n{"b"');
    expect(third.lines.map(parseFrame)).toEqual([{ a: 1 }]);
    expect(third.state.pending).toBe('{"b"');
  });

  it("splits several frames in one chunk and skips empty lines", () => {
    const decoded = decodeChunk(EMPTY_DECODER, '{"a":1}\n\n{"b":2}\r\n{"c":3}\n');
    expect(decoded.lines.map(parseFrame)).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
    expect(decoded.state.pending).toBe("");
  });

  it("refuses a complete line that is longer than the limit", () => {
    expect(() => decodeChunk(EMPTY_DECODER, `${"x".repeat(11)}\n`, 10)).toThrow(HostProtocolError);
    expect(decodeChunk(EMPTY_DECODER, `${"x".repeat(10)}\n`, 10).lines).toHaveLength(1);
  });

  it("refuses a line that is not complete when it is longer than the limit", () => {
    const first = decodeChunk(EMPTY_DECODER, "x".repeat(8), 10);
    expect(() => decodeChunk(first.state, "x".repeat(3), 10)).toThrow(/longer than the limit/);
  });

  it("counts the limit in bytes", () => {
    expect(() => decodeChunk(EMPTY_DECODER, `${"é".repeat(6)}\n`, 10)).toThrow(HostProtocolError);
  });

  it("gives a protocol error for a line that is not JSON", () => {
    expect(() => parseFrame("{not json")).toThrow(HostProtocolError);
    try {
      parseFrame("{not json");
    } catch (error) {
      expect((error as HostProtocolError).code).toBe("HOST_PROTOCOL");
    }
  });
});
