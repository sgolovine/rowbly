import { describe, expect, it } from "vitest";
import { plainRows } from "../../tui/components/text-rows.js";
import { type JsonToken, jsonTokenRows, jsonTokens } from "./json-tokens.js";

const joined = (tokens: readonly JsonToken[]) => tokens.map((token) => token.text).join("");
const meaningful = (tokens: readonly JsonToken[]) => tokens.filter((token) => token.kind !== "plain");

describe("jsonTokens", () => {
  it("gives an object key as key and a string value as string", () => {
    expect(jsonTokens('{"command":"pnpm lint"}')).toEqual([
      { text: "{", kind: "punctuation" },
      { text: '"command"', kind: "key" },
      { text: ":", kind: "punctuation" },
      { text: '"pnpm lint"', kind: "string" },
      { text: "}", kind: "punctuation" },
    ]);
  });

  it("finds a key with whitespace before the colon", () => {
    expect(meaningful(jsonTokens('{ "a" : 1 }')).map((token) => token.kind)).toEqual([
      "punctuation",
      "key",
      "punctuation",
      "number",
      "punctuation",
    ]);
  });

  it("keeps escaped quotes in one string token", () => {
    expect(jsonTokens('"a\\"b"')).toEqual([{ text: '"a\\"b"', kind: "string" }]);
    expect(jsonTokens('{"a\\"b":"c\\\\"}').map((token) => token.kind)).toEqual([
      "punctuation",
      "key",
      "punctuation",
      "string",
      "punctuation",
    ]);
  });

  it("finds numbers with a sign, a fraction and an exponent", () => {
    const tokens = meaningful(jsonTokens("[0, -1, 2.5, -3.25e10, 4E-2, 6e+3]"));

    expect(tokens.filter((token) => token.kind === "number").map((token) => token.text)).toEqual([
      "0",
      "-1",
      "2.5",
      "-3.25e10",
      "4E-2",
      "6e+3",
    ]);
  });

  it("finds the three literals", () => {
    const tokens = jsonTokens("[true,false,null]");

    expect(tokens.filter((token) => token.kind === "literal").map((token) => token.text)).toEqual([
      "true",
      "false",
      "null",
    ]);
  });

  it("does not give a literal or a number in a word", () => {
    expect(meaningful(jsonTokens("nullable truely v1.5.2 abc123"))).toEqual([]);
  });

  it("gives the tokens of nested arrays and objects", () => {
    const text = '{"a":[1,{"b":[true,"x"]}],"c":{}}';
    const tokens = jsonTokens(text);

    expect(joined(tokens)).toBe(text);
    expect(tokens.filter((token) => token.kind === "key").map((token) => token.text)).toEqual(['"a"', '"b"', '"c"']);
    expect(tokens.filter((token) => token.kind === "string").map((token) => token.text)).toEqual(['"x"']);
    expect(tokens.filter((token) => token.kind === "punctuation")).toHaveLength(16);
  });

  it("gives tokens for cut JSON and does not throw", () => {
    const text = '{"command":"pnpm te';
    const tokens = jsonTokens(text);

    expect(joined(tokens)).toBe(text);
    expect(tokens.at(-1)).toEqual({ text: '"pnpm te', kind: "string" });

    for (const cut of ['{"a', '{"a":', '{"a":-', '{"a":1.', '{"a":1e', '"\\', "[tr"]) {
      expect(joined(jsonTokens(cut))).toBe(cut);
    }
  });

  it("gives tokens for text that is not JSON, with the same text", () => {
    for (const text of ["", "hello world", "Error: x [1] at line 3\n  next", "a\tb\r\nc", "emoji 🎉 \u0000 :,"]) {
      expect(joined(jsonTokens(text))).toBe(text);
    }
  });
});

describe("jsonTokenRows", () => {
  it("gives the same row text as plainRows", () => {
    const text = '{"command":"pnpm lint 2>&1 | tail -30","timeout":300}\n[1,\n2]\n\n🎉🎉🎉';

    for (const width of [1, 5, 13, 80]) {
      expect(jsonTokenRows(text, width).map(joined)).toEqual(plainRows(text, width));
    }
  });

  it("keeps the kind of a token that wraps to the next row", () => {
    const rows = jsonTokenRows('{"k":"abcdefghij"}', 8);

    expect(rows[0]).toEqual([
      { text: "{", kind: "punctuation" },
      { text: '"k"', kind: "key" },
      { text: ":", kind: "punctuation" },
      { text: '"ab', kind: "string" },
    ]);
    expect(rows[1]).toEqual([{ text: "cdefghij", kind: "string" }]);
    expect(rows[2]).toEqual([
      { text: '"', kind: "string" },
      { text: "}", kind: "punctuation" },
    ]);
  });

  it("gives one empty row for empty text", () => {
    expect(jsonTokenRows("", 10)).toEqual([[]]);
  });
});
