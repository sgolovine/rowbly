import { definePlugin } from '../../plugin-api';
import { appendAttachment, requireAttachments } from './attachments';
import { commands } from './commands';
import { doctor } from './doctor';
import { AttachmentsBag, AttachmentsInput } from './model';

export const attachments = definePlugin({
  id: 'attachments',
  name: 'Attachments',
  description: 'PNG Attachments on Stories',
  bags: { story: AttachmentsBag },
  inputs: { 'stories.create': AttachmentsInput, 'stories.update': AttachmentsInput },
  hooks: {
    'stories.create': {
      async transform({ changes, result, pluginInput, plugin }) {
        if (!pluginInput) return;
        for (const image of pluginInput.images)
          await appendAttachment(changes, plugin, result.key, {
            name: image.name,
            bytes: Buffer.from(image.png, 'base64'),
          });
      },
    },
    'stories.update': {
      async transform({ changes, input, pluginInput, plugin }) {
        if (!pluginInput) return;
        for (const image of pluginInput.images)
          await appendAttachment(changes, plugin, input.key, {
            name: image.name,
            bytes: Buffer.from(image.png, 'base64'),
          });
      },
    },
  },
  tui: () => import('./tui').then((m) => m.tui),
  commands,
  async storyContext(story, plugin) {
    // Names only: the images stay in their files, opened with `attachments open`.
    const list = requireAttachments(plugin, story);
    const text = list.map((a) => `- \`${a.id}\` ${a.name} (${a.type}, ${a.size} bytes)`);
    return { title: 'Attachments', text: text.join('\n') || 'None.', data: list };
  },
  doctor,
});
