import type { AnyPluginDefinition, PluginTui } from '../../../src/plugin-api';

/** An image consumer used to check exclusive TUI activation. */
export const pasteTui: PluginTui = {
  storyPaste: {
    async story() {},
    form({ image, setPending }) {
      setPending(image);
    },
    input({ pending }) {
      return pending;
    },
  },
};

export const paste: AnyPluginDefinition = {
  id: 'paste',
  name: 'Paste',
  description: 'Consumes clipboard images',
  tui: async () => pasteTui,
};
