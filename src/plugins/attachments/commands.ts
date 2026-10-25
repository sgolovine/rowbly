import { clipboard, colors, type PluginCommands, readBinaryInput, UsageError } from '../../plugin-api';
import {
  addAttachment,
  clipboardName,
  getAttachment,
  listAttachments,
  openAttachment,
  removeAttachment,
} from './attachments';
import { MAX_ATTACHMENT_BYTES } from './model';

export const commands: PluginCommands = (group, cli) => {
  group
    .command('add <target> [file]')
    .description('Add a PNG Attachment to a Story')
    .option('--from-clipboard', 'read a PNG image from the clipboard')
    .action((target: string, file: string | undefined, opts: { fromClipboard?: boolean }, cmd) =>
      cli.run(cmd, async ({ plugin, print }) => {
        if (Boolean(file) === Boolean(opts.fromClipboard)) throw new UsageError('give a file or --from-clipboard');
        let input: { name: string; bytes: Uint8Array };
        if (opts.fromClipboard) {
          const image = await clipboard.readImage();
          if ('reason' in image) throw new UsageError(`cannot read clipboard image: ${image.reason}`);
          input = { name: clipboardName(plugin.now()), bytes: image.bytes };
        } else input = await readBinaryInput(file as string, MAX_ATTACHMENT_BYTES);
        print(await addAttachment(plugin, target, input), (entry) => `Added Attachment ${entry.id}: ${entry.name}`);
      }),
    );
  group
    .command('list <target>')
    .description('List Attachments on a Story, oldest first')
    .action((target: string, _opts: unknown, cmd) =>
      cli.run(cmd, async ({ plugin, print }) => {
        print(await listAttachments(plugin, target), (entries) =>
          entries.length
            ? entries
                .map(
                  (entry) =>
                    `${entry.id}  ${entry.name}  ${entry.type}  ${entry.size} bytes  ${entry.createdAt}  ${entry.createdBy ?? 'unknown'}`,
                )
                .join('\n')
            : colors.dim('No Attachments yet.'),
        );
      }),
    );
  group
    .command('remove <target> <id>')
    .description('Remove an Attachment and its PNG')
    .action((target: string, id: string, _opts: unknown, cmd) =>
      cli.run(cmd, async ({ plugin, print, confirm }) => {
        await getAttachment(plugin, target, id);
        await confirm(`Remove Attachment ${id}?`);
        print(await removeAttachment(plugin, target, id), () => `Removed Attachment ${id}`);
      }),
    );
  group
    .command('open <target> <id>')
    .description('Open an Attachment in the associated application')
    .action((target: string, id: string, _opts: unknown, cmd) =>
      cli.run(cmd, async ({ plugin, print }) => {
        await openAttachment(plugin, target, id);
        print({ opened: id }, () => `Opened Attachment ${id}`);
      }),
    );
};
