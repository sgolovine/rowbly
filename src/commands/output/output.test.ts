import { Command, InvalidArgumentError } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotFoundError, ValidationError } from "../../services/errors/errors.js";
import { collect, formatValue, parseFieldFlags, parseInteger, parsePosition, run } from "./output.js";

function command(args: string[] = []): Command {
  const program = new Command().option("--json").option("-C, --cwd <dir>").exitOverride();
  program.parse(args, { from: "user" });
  return program;
}

describe("output", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  function capture(): { out: string[]; err: string[] } {
    const out: string[] = [];
    const err: string[] = [];
    vi.spyOn(console, "log").mockImplementation((text: string) => void out.push(text));
    vi.spyOn(console, "error").mockImplementation((text: string) => void err.push(text));
    return { out, err };
  }

  describe("run", () => {
    it("passes --cwd to the service and prints the text of the result", async () => {
      const { out } = capture();
      const call = vi.fn(async () => ({ id: "ROW-01" }));
      await run(command(["-C", "/tmp/x"]), call, (result, ctx) => `${result.id} in ${ctx.cwd}`);
      expect(call).toHaveBeenCalledWith({ cwd: "/tmp/x" });
      expect(out).toEqual(["ROW-01 in /tmp/x"]);
      expect(process.exitCode).toBeUndefined();
    });

    it("prints the result as JSON with --json", async () => {
      const { out } = capture();
      await run(
        command(["--json"]),
        async () => ({ id: "ROW-01" }),
        () => "text",
      );
      expect(JSON.parse(out.join("\n"))).toEqual({ id: "ROW-01" });
    });

    it("prints a RowblyError with its hint and sets exit code 1", async () => {
      const { out, err } = capture();
      await run(
        command(),
        async () => {
          throw new NotFoundError("Story ROW-09 not found", { hint: "Run `rowbly story search`." });
        },
        () => "text",
      );
      expect(out).toEqual([]);
      expect(err).toEqual(["Error: Story ROW-09 not found", "Hint: Run `rowbly story search`."]);
      expect(process.exitCode).toBe(1);
    });

    it("lists each issue when there is more than one", async () => {
      const { err } = capture();
      const issues = [
        { path: ["title"], message: "Title is required" },
        { path: ["stage"], message: "Unknown stage" },
      ];
      await run(
        command(),
        async () => {
          throw new ValidationError("The story is invalid", { details: { issues } });
        },
        () => "text",
      );
      expect(err).toEqual(["Error: The story is invalid", "  - Title is required", "  - Unknown stage"]);
    });

    it("prints a RowblyError as JSON with --json", async () => {
      const { err } = capture();
      await run(
        command(["--json"]),
        async () => {
          throw new NotFoundError("Not found", { hint: "Look again", details: { id: "ROW-09" } });
        },
        () => "text",
      );
      expect(JSON.parse(err.join("\n"))).toEqual({
        error: { code: "NOT_FOUND", message: "Not found", hint: "Look again", details: { id: "ROW-09" } },
      });
      expect(process.exitCode).toBe(1);
    });

    it("rethrows an error that is not a RowblyError", async () => {
      capture();
      const bug = new TypeError("bug");
      await expect(
        run(
          command(),
          async () => {
            throw bug;
          },
          () => "text",
        ),
      ).rejects.toBe(bug);
      expect(process.exitCode).toBeUndefined();
    });
  });

  it("collect appends each value", () => {
    expect(collect("a")).toEqual(["a"]);
    expect(collect("b", ["a"])).toEqual(["a", "b"]);
  });

  describe("parseFieldFlags", () => {
    it("returns undefined without flags", () => {
      expect(parseFieldFlags(undefined)).toBeUndefined();
      expect(parseFieldFlags([])).toBeUndefined();
    });

    it("splits each flag at the first =", () => {
      expect(parseFieldFlags([" points =3", "url=https://x.test/?a=b", "owner="])).toEqual({
        points: "3",
        url: "https://x.test/?a=b",
        owner: "",
      });
    });

    it("rejects a flag without a key", () => {
      expect(() => parseFieldFlags(["points"])).toThrow(ValidationError);
      expect(() => parseFieldFlags(["=3"])).toThrow('--field expects key=value, got "=3"');
    });
  });

  it("parsePosition accepts only whole numbers from 1", () => {
    expect(parsePosition("2")).toBe(2);
    for (const value of ["0", "-1", "1.5", "x"]) expect(() => parsePosition(value)).toThrow(InvalidArgumentError);
  });

  it("parseInteger accepts only whole numbers", () => {
    expect(parseInteger("120")).toBe(120);
    expect(parseInteger("10")).toBe(10);
    for (const value of ["", " ", "1.5", "x"]) expect(() => parseInteger(value)).toThrow(InvalidArgumentError);
  });

  it("formatValue shows an unset value as a dash", () => {
    expect(formatValue(null)).toBe("—");
    expect(formatValue(3)).toBe("3");
    expect(formatValue(false)).toBe("false");
  });
});
