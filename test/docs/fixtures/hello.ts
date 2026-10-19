// The tutorial's first Plugin (docs/plugins/writing-a-plugin.md, step 2). As a Built-in Plugin it would be
// src/plugins/hello/index.ts; `test/docs/tutorial.test.ts` checks that the guide shows this region.
// #region hello
import { definePlugin } from '../../../src/plugin-api';
// biome-ignore format: the guide shows this declaration in five lines.
export const hello = definePlugin({
  id: 'hello', name: 'Hello', description: 'Shows the Story Key',
  storyRows: async (story) => [{ label: 'Hello', value: story.key }],
});
// #endregion
