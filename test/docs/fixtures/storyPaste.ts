// #region story-paste
import type { PluginPasteImage, PluginTui } from '../../../src/plugin-api';

export const imageTui: PluginTui = {
  storyForm: {
    async fields() {
      return [];
    },
    input() {
      return undefined;
    },
    pendingSummary({ pending }) {
      return { label: 'Images', value: `${(pending as PluginPasteImage[]).length} pending` };
    },
  },
  storyPaste: {
    clipboardFallback: 'use the Plugin command to add an image file',
    async story({ story, image, plugin, ui }) {
      await plugin.operation('paste', { key: story.key }, (changes) =>
        changes.writeBinaryFile({ story: story.key }, 'clipboard.png', image.bytes),
      );
      ui.toast('Saved clipboard image');
    },
    form({ image, pending, setPending, ui }) {
      const images = (pending ?? []) as PluginPasteImage[];
      setPending([...images, image]);
      ui.toast('Image ready for Story save');
    },
    input({ pending }) {
      // The Plugin's stories.create/update transform consumes these bytes in the same Change Set.
      return { images: (pending as PluginPasteImage[]).map((image) => Buffer.from(image.bytes).toString('base64')) };
    },
  },
};
// #endregion
