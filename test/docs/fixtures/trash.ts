// The tutorial's advanced example (docs/WRITING-A-PLUGIN.md, step 11): a replacement.
// #region replacement
import { definePlugin } from '../../../src/plugin-api';

/** Keeps a copy of each deleted Story in its Board's `plugins/trash/` folder. */
export const trash = definePlugin({
  id: 'trash',
  name: 'Trash',
  description: 'Keeps a copy of each deleted Story',
  replaces: {
    async 'stories.remove'({ input, changes, core, plugin }) {
      const story = await plugin.services.stories.get(input.key);
      // The copy and the deletion are one Change Set: both are saved, or neither.
      await changes.writeFile({ board: story.boardId }, `${story.key}.json`, `${JSON.stringify(story, null, 2)}\n`);
      // At most once; its errors pass through with their own code. Its result is the operation's result.
      return core();
    },
  },
});
// #endregion
