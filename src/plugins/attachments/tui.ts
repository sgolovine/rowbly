import { type PluginTui, ValidationError } from '../../plugin-api';
import { AttachmentFormScreen } from './AttachmentFormScreen';
import { AttachmentsTab } from './AttachmentsTab';
import { addAttachment, clipboardName } from './attachments';
import { formatSize } from './formatSize';
import { AttachmentsBag, MAX_ATTACHMENT_BYTES } from './model';

type PendingImage = { name: string; bytes: Uint8Array };
function pendingImages(pending: unknown): PendingImage[] {
  return (pending ?? []) as PendingImage[];
}
export const tui: PluginTui<unknown> = {
  screens: { form: AttachmentFormScreen },
  storyTabs: [{ label: 'Attachments', component: AttachmentsTab }],
  storyBadges: ({ story, plugin }) => {
    const count = plugin.readBag(story, AttachmentsBag)?.attachments.length ?? 0;
    return count ? [`📎${count}`] : [];
  },
  storyForm: {
    async fields() {
      return [];
    },
    input() {
      return undefined;
    },
    pendingSummary({ pending }) {
      const images = pendingImages(pending);
      return {
        label: 'Attachments',
        value: `${images.length} ${images.length === 1 ? 'image' : 'images'} (${formatSize(images.reduce((size, image) => size + image.bytes.length, 0))})`,
      };
    },
  },
  storyPaste: {
    clipboardFallback: 'use rowbly attachments add <KEY> <file>',
    async story({ story, image, plugin, ui }) {
      const added = await addAttachment(plugin, story.key, { name: clipboardName(plugin.now()), bytes: image.bytes });
      ui.toast(`Attached ${added.name} (${formatSize(added.size)})`);
    },
    form({ image, pending, setPending, plugin, ui }) {
      const images = pendingImages(pending);
      if (images.reduce((size, entry) => size + entry.bytes.length, image.bytes.length) > MAX_ATTACHMENT_BYTES)
        throw new ValidationError('Pending images exceed 10 MiB; save this Story before pasting more');
      const added = { name: clipboardName(plugin.now()), bytes: new Uint8Array(image.bytes) };
      setPending([...images, added]);
      ui.toast(`Image ready for Story save: ${added.name} (${formatSize(added.bytes.length)})`);
    },
    input({ pending }) {
      return {
        images: pendingImages(pending).map((image) => ({
          name: image.name,
          png: Buffer.from(image.bytes).toString('base64'),
        })),
      };
    },
  },
};
