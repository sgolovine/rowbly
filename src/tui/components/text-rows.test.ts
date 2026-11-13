import { describe, expect, it } from "vitest";
import { plainRows, wordRows } from "./text-rows.js";

describe("plainRows", () => {
  it("breaks each line at the width, and keeps an empty line", () => {
    expect(plainRows("abcde\n\nfg", 2)).toEqual(["ab", "cd", "e", "", "fg"]);
  });

  it("counts a wide character as one character", () => {
    expect(plainRows("😀😀😀", 2)).toEqual(["😀😀", "😀"]);
  });
});

describe("wordRows", () => {
  it("breaks between words where a word fits on a row", () => {
    expect(wordRows("one two three", 7)).toEqual(["one two", "three"]);
  });

  it("breaks a word longer than the row at the width", () => {
    expect(wordRows("a abcdefg b", 3)).toEqual(["a", "abc", "def", "g b"]);
  });

  it("drops the spaces at the start of a row, and keeps the other spaces", () => {
    expect(wordRows("  a  b", 10)).toEqual(["a  b"]);
  });

  it("gives one row for an empty line", () => {
    expect(wordRows("a\n\nb", 5)).toEqual(["a", "", "b"]);
  });
});
