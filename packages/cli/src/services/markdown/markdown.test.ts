import { describe, expect, it } from "vitest";
import { ValidationError } from "../errors/errors.js";
import { parseMarkdown, serializeMarkdown } from "./markdown.js";

describe("parseMarkdown", () => {
  it("splits the frontmatter and the body", () => {
    expect(parseMarkdown("---\ntitle: Hi\nn: 1\n---\n\nBody text\n", "f.md")).toEqual({
      data: { title: "Hi", n: 1 },
      body: "Body text",
    });
  });

  it("returns empty data when there is no frontmatter", () => {
    expect(parseMarkdown("Just text", "f.md")).toEqual({ data: {}, body: "Just text" });
  });

  it("returns empty data for empty frontmatter", () => {
    expect(parseMarkdown("---\n---\nBody", "f.md").data).toEqual({});
  });

  it("gives each call its own data object", () => {
    const text = "---\ntitle: Hi\n---\n";
    const first = parseMarkdown(text, "f.md");
    first.data.title = "Changed";
    expect(parseMarkdown(text, "f.md").data.title).toBe("Hi");
  });

  it("throws a ValidationError for invalid YAML", () => {
    const error = (() => {
      try {
        parseMarkdown("---\ntitle: [unclosed\n---\n", "f.md");
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).message).toMatch(/^f\.md has invalid frontmatter/);
    expect((error as ValidationError).details.reason).toBeTypeOf("string");
  });

  it("throws a ValidationError when the frontmatter is not a map", () => {
    expect(() => parseMarkdown("---\n- a\n- b\n---\n", "f.md")).toThrow(ValidationError);
  });
});

describe("serializeMarkdown", () => {
  it("writes only the body when there is no data", () => {
    expect(serializeMarkdown({ data: {}, body: " Body " })).toBe("Body\n");
    expect(serializeMarkdown({ data: {}, body: "" })).toBe("");
  });

  it("writes frontmatter and body", () => {
    expect(serializeMarkdown({ data: { title: "Hi", x: null }, body: "Body" })).toBe(
      "---\ntitle: Hi\nx: null\n---\n\nBody\n",
    );
  });

  it("round-trips through parseMarkdown", () => {
    const doc = { data: { title: "A long title: with a colon", list: [1, 2] }, body: "# Heading\n\nText" };
    expect(parseMarkdown(serializeMarkdown(doc), "f.md")).toEqual(doc);
  });
});
