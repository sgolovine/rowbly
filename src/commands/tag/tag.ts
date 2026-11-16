import type { Command } from "commander";
import type { TagConfig } from "../../services/config/config.js";
import { addTag, listTags, removeTag, updateTag } from "../../services/tag/tag.js";
import { run } from "../output/output.js";

function describe(tag: TagConfig): string {
  return `${tag.value} (${tag.label})`;
}

function listText(tags: readonly TagConfig[]): string {
  return tags.length === 0 ? "No tags." : tags.map(describe).join("\n");
}

/** Registers the `rowbly tag` subcommands on the `tag` command. */
export function registerTagCommands(program: Command): void {
  program
    .command("list")
    .description("List the tags of the project")
    .action((_opts: unknown, command: Command) => run(command, (ctx) => listTags(ctx), listText));

  program
    .command("add")
    .description("Add a tag to the project")
    .requiredOption("--label <label>", "tag name, e.g. Front end")
    .requiredOption("--value <value>", "tag value in the stories, e.g. frontend; it cannot change later")
    .action((opts: { label: string; value: string }, command: Command) =>
      run(
        command,
        (ctx) => addTag({ label: opts.label, value: opts.value }, ctx),
        (tag) => `Added tag ${describe(tag)}`,
      ),
    );

  program
    .command("update <value>")
    .description("Change the label of a tag")
    .requiredOption("--label <label>", "new name")
    .action((value: string, opts: { label: string }, command: Command) =>
      run(
        command,
        (ctx) => updateTag({ value, label: opts.label }, ctx),
        (tag) => `Updated tag ${describe(tag)}`,
      ),
    );

  program
    .command("remove <value>")
    .description("Remove a tag from the project and from every story")
    .action((value: string, _opts: unknown, command: Command) =>
      run(
        command,
        (ctx) => removeTag({ value }, ctx),
        (tag) => `Removed tag ${tag.value}`,
      ),
    );
}
