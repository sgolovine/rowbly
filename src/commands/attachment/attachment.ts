import type { Command } from "commander";
import {
  addAttachment,
  listAttachments,
  openAttachment,
  removeAttachment,
} from "../../services/attachment/attachment.js";
import { run } from "../output/output.js";

/** Registers the `rowbly` attachment commands on the root program. */
export function registerAttachmentCommands(program: Command): void {
  program
    .command("add-attachment <story> [file]")
    .description("Attach a PNG image to a Story")
    .option("--from-clipboard", "read a PNG from the clipboard")
    .action((story: string, file: string | undefined, opts: { fromClipboard?: boolean }, command: Command) =>
      run(
        command,
        (ctx) => addAttachment({ story, file, fromClipboard: opts.fromClipboard }, ctx),
        (a) => `Attached ${a?.name} (${a?.id})`,
      ),
    );

  program
    .command("list-attachments <story>")
    .description("List the PNG images of a Story")
    .action((story: string, _opts: unknown, command: Command) =>
      run(
        command,
        (ctx) => listAttachments({ story }, ctx),
        (items) =>
          items.length ? items.map((a) => `${a.id}  ${a.name}  ${a.size} bytes`).join("\n") : "No attachments.",
      ),
    );

  program
    .command("open-attachment <story> <id>")
    .description("Open a PNG with the associated application")
    .action((story: string, id: string, _opts: unknown, command: Command) =>
      run(
        command,
        (ctx) => openAttachment({ story, id }, ctx),
        (r) => `Opened ${r.opened}`,
      ),
    );

  program
    .command("remove-attachment <story> <id>")
    .description("Remove an attachment and its PNG")
    .action((story: string, id: string, _opts: unknown, command: Command) =>
      run(
        command,
        (ctx) => removeAttachment({ story, id }, ctx),
        (r) => `Removed ${r.removed}`,
      ),
    );
}
