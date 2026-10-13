// Small fixture Plugins, each for one part of the pipeline or one way to fail to load.
import { definePlugin, parseStoryKey, z } from '../../../src/plugin-api';

/** Replaces `tasks.create`: runs core, then stamps the new Task's name in the same Change Set. */
export const stamp = definePlugin({
  id: 'stamp',
  name: 'Stamp',
  description: 'Stamps new Tasks',
  replaces: {
    'tasks.create': async ({ core, changes, input }) => {
      const task = await core();
      const story = await changes.updateStory(input.storyKey, (s) => ({
        ...s,
        tasks: s.tasks.map((t) => (t.id === task.id ? { ...t, name: `[stamped] ${t.name}` } : t)),
      }));
      return story.tasks.find((t) => t.id === task.id) ?? task;
    },
  },
});

/** Another replacement of `tasks.create`: always clashes with `stamp`, which is earlier. */
export const rival = definePlugin({
  id: 'rival',
  name: 'Rival',
  description: 'Also replaces tasks.create',
  replaces: { 'tasks.create': async ({ core }) => core() },
});

/** Throws while it starts. */
export const boom = definePlugin({
  id: 'boom',
  name: 'Boom',
  description: 'Fails to start',
  start() {
    throw new Error('boom at start');
  },
});

/** Needs a number setting. */
export const strict = definePlugin<{ level: number }>({
  id: 'strict',
  name: 'Strict',
  description: 'Has a required setting',
  settings: z.object({ level: z.number() }),
});

/** Adds `--name` to `stories create`, which core already has. */
export const clash = definePlugin({
  id: 'clash',
  name: 'Clash',
  description: 'Takes a core option',
  options: { 'stories create': { options: [{ flags: '--name <n>', description: 'clashes' }], input: () => undefined } },
});

/** Has the id of a core command. */
export const storiesPlugin = definePlugin({ id: 'stories', name: 'Stories', description: 'Clashes with core' });

/** Its transform of `boards.update` throws. */
export const faulty = definePlugin({
  id: 'faulty',
  name: 'Faulty',
  description: 'Fails while transforming',
  hooks: {
    'boards.update': {
      transform() {
        throw new Error('kaboom');
      },
    },
  },
});

/** Its reaction to `boards.update` throws, after the save. */
export const echo = definePlugin({
  id: 'echo',
  name: 'Echo',
  description: 'Fails while reacting',
  hooks: {
    'boards.update': {
      react() {
        throw new Error('echo failed');
      },
    },
  },
});

/** Records the order its handlers run in, and guards Board deletion like Specs will. */
export const order: string[] = [];

export const tracer = definePlugin({
  id: 'tracer',
  name: 'Tracer',
  description: 'Records the order of handlers',
  hooks: {
    'stories.move': {
      transform: ({ changes }) => {
        order.push(`transform:${changes.changes.length}`);
      },
      guard: () => {
        order.push('guard');
        return undefined;
      },
      react: ({ result }) => {
        order.push(`react:${result.stage}`);
      },
    },
    'boards.remove': {
      guard: ({ input }) =>
        input.force ? undefined : { reject: `Board "${input.id}" has tracer files`, hint: 'pass --force' },
    },
  },
  storyRows: async (story) => [{ label: 'Number', value: String(parseStoryKey(story.key).n) }],
});
