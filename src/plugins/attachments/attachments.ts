import {
  type Bagged,
  ConflictError,
  NotFoundError,
  type PluginContext,
  type PluginReadContext,
  toTimestamp,
  ValidationError,
} from '../../plugin-api';
import { type Attachment, AttachmentsBag, MAX_ATTACHMENT_BYTES } from './model';

export function requireAttachments(plugin: PluginReadContext, story: Bagged): Attachment[] {
  return plugin.requireBag(story, AttachmentsBag)?.attachments ?? [];
}

export async function listAttachments(plugin: PluginContext, target: string): Promise<Attachment[]> {
  return requireAttachments(plugin, await plugin.services.stories.get(target));
}

export async function getAttachment(plugin: PluginContext, target: string, id: string): Promise<Attachment> {
  const attachment = (await listAttachments(plugin, target)).find((entry) => entry.id === id);
  if (!attachment)
    throw new NotFoundError(`Attachment "${id}" not found on ${target}`, {
      hint: `run \`rowbly attachments list ${target}\``,
    });
  return attachment;
}

/** UTC clipboard name, shared by CLI and the future Story paste handler. */
export function clipboardName(now: Date): string {
  const iso = now.toISOString();
  return `image-${iso.slice(0, 10).replaceAll('-', '')}-${iso.slice(11, 16).replace(':', '')}.png`;
}

/** Callers read the file or clipboard before this operation; the bytes are copied before awaiting. */
export function addAttachment(
  plugin: PluginContext,
  target: string,
  input: { name: string; bytes: Uint8Array },
): Promise<Attachment> {
  const bytes = new Uint8Array(input.bytes);
  const name = input.name;
  validatePng(bytes);
  let ownerKey = target;
  return plugin.operation(
    'add',
    { target, name },
    async (changes) => {
      const story = await plugin.services.stories.get(target);
      ownerKey = story.key;
      const entries = requireAttachments(plugin, story);
      const attachment: Attachment = {
        id: `a${plugin.newId()}`,
        name,
        type: 'image/png',
        size: bytes.length,
        createdAt: toTimestamp(plugin.now()),
        createdBy: plugin.me,
      };
      // Never replace recoverable bytes, even when the bag does not reference them.
      if (
        entries.some((entry) => entry.id === attachment.id) ||
        (await changes.readBinaryFile({ story: story.key }, `${attachment.id}.png`)) !== null
      )
        throw new ConflictError('Attachment id already exists; try again');
      await changes.updateStory(story.key, (current) => ({
        ...plugin.writeBag(current, { attachments: [...requireAttachments(plugin, current), attachment] }),
        updatedAt: toTimestamp(plugin.now()),
      }));
      await changes.writeBinaryFile({ story: story.key }, `${attachment.id}.png`, bytes);
      return attachment;
    },
    {
      async result(changes, added) {
        const story = changes.story(ownerKey)?.after;
        const saved = story && requireAttachments(plugin, story).find((entry) => entry.id === added.id);
        if (!saved || (await changes.readBinaryFile({ story: story.key }, `${added.id}.png`)) === null)
          throw new ConflictError('Attachment was removed before it was saved');
        return saved;
      },
    },
  );
}

export function removeAttachment(plugin: PluginContext, target: string, id: string): Promise<{ removed: string }> {
  return plugin.operation('remove', { target, id }, async (changes) => {
    const story = await plugin.services.stories.get(target);
    await changes.updateStory(story.key, (current) => {
      const entries = requireAttachments(plugin, current);
      if (!entries.some((entry) => entry.id === id))
        throw new NotFoundError(`Attachment "${id}" not found on ${target}`);
      const attachments = entries.filter((entry) => entry.id !== id);
      return {
        ...plugin.writeBag(current, attachments.length ? { attachments } : undefined),
        updatedAt: toTimestamp(plugin.now()),
      };
    });
    await changes.deleteFile({ story: story.key }, `${id}.png`);
    return { removed: id };
  });
}

export async function openAttachment(plugin: PluginContext, target: string, id: string): Promise<void> {
  const attachment = await getAttachment(plugin, target, id);
  await plugin.openFile({ story: target }, `${attachment.id}.png`);
}

function validatePng(bytes: Uint8Array): void {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new ValidationError('Attachment exceeds 10 MiB');
  if (!signature.every((byte, index) => bytes[index] === byte))
    throw new ValidationError('Attachment must be a PNG image');
}
