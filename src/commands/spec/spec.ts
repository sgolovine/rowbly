import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { text } from "node:stream/consumers";
import type { Command } from "commander";
import { ValidationError } from "../../services/errors/errors.js";
import {
  createSpec,
  deleteSpec,
  getSpec,
  linkSpec,
  listSpecs,
  type Spec,
  unlinkSpec,
  updateSpec,
} from "../../services/spec/spec.js";
import type { ServiceContext } from "../../services/workspace/workspace.js";
import { collect, run } from "../output/output.js";

interface SpecOptions {
  title?: string;
  slug?: string;
  story?: string[];
  body?: string;
  bodyFile?: string;
}

function formatSpec(spec: Spec): string {
  const lines = [`${spec.slug}  ${spec.title}`, `Stories: ${spec.stories.join(", ") || "—"}`];
  if (spec.body) lines.push("", spec.body);
  return lines.join("\n");
}

/**
 * The body from `--body` or `--body-file` (`-` reads stdin), relative to the directory of `-C`. Neither
 * flag gives `undefined`, and both flags are an error.
 */
async function readBody(opts: SpecOptions, ctx: ServiceContext): Promise<string | undefined> {
  if (opts.body !== undefined && opts.bodyFile !== undefined) {
    throw new ValidationError("Use --body or --body-file, not both");
  }
  if (opts.bodyFile === undefined) return opts.body;
  if (opts.bodyFile === "-") return text(process.stdin);
  return readFile(resolve(ctx.cwd ?? process.cwd(), opts.bodyFile), "utf8");
}

export function registerSpecCommands(program: Command): void {
  program
    .command("create-spec")
    .description("Create a spec and link it to one or more stories")
    .requiredOption("--title <title>", "spec title")
    .requiredOption("--story <id>", "link to this story (repeatable)", collect)
    .option("--slug <slug>", "file name in .rowbly/specs/ (default: made from the title)")
    .option("--body <markdown>", "spec body")
    .option("--body-file <path>", "read the spec body from a file; - reads stdin")
    .action((opts: SpecOptions & { title: string; story: string[] }, command: Command) =>
      run(
        command,
        async (ctx) =>
          createSpec({ title: opts.title, slug: opts.slug, stories: opts.story, body: await readBody(opts, ctx) }, ctx),
        (spec) => `Created spec ${spec.slug} for ${spec.stories.join(", ")}`,
      ),
    );

  program
    .command("update-spec <slug>")
    .description("Update a spec")
    .option("--title <title>", "new title")
    .option("--story <id>", "replace the linked stories (repeatable)", collect)
    .option("--body <markdown>", "replace the body")
    .option("--body-file <path>", "replace the body with a file; - reads stdin")
    .action((slug: string, opts: SpecOptions, command: Command) =>
      run(
        command,
        async (ctx) =>
          updateSpec({ slug, title: opts.title, stories: opts.story, body: await readBody(opts, ctx) }, ctx),
        (spec) => `Updated spec ${spec.slug}`,
      ),
    );

  program
    .command("delete-spec <slug>")
    .description("Delete a spec")
    .action((slug: string, _opts: unknown, command: Command) =>
      run(
        command,
        (ctx) => deleteSpec({ slug }, ctx),
        (result) => `Deleted spec ${result.slug}`,
      ),
    );

  program
    .command("get-spec <slug>")
    .description("Show a spec")
    .action((slug: string, _opts: unknown, command: Command) =>
      run(command, (ctx) => getSpec({ slug }, ctx), formatSpec),
    );

  program
    .command("list-specs")
    .description("List the specs")
    .option("--story <id>", "only the specs linked to this story")
    .action((opts: { story?: string }, command: Command) =>
      run(
        command,
        (ctx) => listSpecs({ story: opts.story }, ctx),
        (specs) =>
          specs.length === 0
            ? "No specs found."
            : specs
                .map((spec) => `${spec.slug.padEnd(24)} ${spec.stories.join(",").padEnd(14)} ${spec.title}`)
                .join("\n"),
      ),
    );

  program
    .command("link-spec <slug> <story>")
    .description("Link a spec to one more story")
    .action((slug: string, story: string, _opts: unknown, command: Command) =>
      run(
        command,
        (ctx) => linkSpec({ slug, story }, ctx),
        (spec) => `Linked spec ${spec.slug} to ${spec.stories.join(", ")}`,
      ),
    );

  program
    .command("unlink-spec <slug> <story>")
    .description("Remove the link from a spec to a story; a spec keeps at least one story")
    .action((slug: string, story: string, _opts: unknown, command: Command) =>
      run(
        command,
        (ctx) => unlinkSpec({ slug, story }, ctx),
        (spec) => `Unlinked spec ${spec.slug}; it stays linked to ${spec.stories.join(", ")}`,
      ),
    );
}
