// A generated Data Root for scaling checks (PERF-07), after the corrected `gen.mjs` of the review's
// historical evidence: one Board `web`, Stories with one Task each, Epics (every tenth closed), Board
// Specs plus `common`, and two Story Comments per Story. Every Story links one
// Spec and `common`, and belongs to one Epic. Every record is parsed by its schema before it is
// written, so the root is valid by construction; doctor must still find nothing before a timing.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CommentsBag } from '../../src/plugins/comments/model';
import { EpicBag, EpicSchema } from '../../src/plugins/epics/model';
import { SpecsBag } from '../../src/plugins/specs/specs';
import { TasksBag } from '../../src/plugins/tasks/model';
import { BoardConfigSchema, RowblyConfigSchema, type Story, StorySchema } from '../../src/schemas';
import { FIXED_NOW } from '../helpers/clock';
import { writeFixture } from '../helpers/fixtures';

export interface FixtureShape {
  stories: number;
  /** Default 50. */
  epics?: number;
  /** Board Specs besides `common`. Default 20. */
  specs?: number;
  /** Whether the Built-in Plugins are on. Their data is there either way. Default on. */
  plugins?: boolean;
}

/** The built-in Plugins the fixture holds data for, in registry order. */
export const FIXTURE_PLUGINS = ['tasks', 'epics', 'specs', 'comments'] as const;

const STAGES = ['backlog', 'todo', 'in-progress', 'done'];
/** Files written at once; enough to keep the disk busy without exhausting file handles. */
const BATCH = 200;

/** Writes the fixture's Data Root at `path`, which must not exist yet. */
export async function generateFixture(path: string, shape: FixtureShape): Promise<void> {
  const { stories, epics = 50, specs = 20, plugins = true } = shape;
  const ts = FIXED_NOW;
  await mkdir(path, { recursive: true });
  await writeFixture(join(path, 'rowbly.config.json'), RowblyConfigSchema, {
    version: 1,
    plugins: Object.fromEntries(FIXTURE_PLUGINS.map((id) => [id, { enabled: plugins }])),
  });
  await writeFixture(join(path, 'boards/web/board.config.json'), BoardConfigSchema, {
    version: 1,
    id: 'web',
    name: 'Web',
    keyPrefix: 'WEB',
    description: '',
    createdAt: ts,
    updatedAt: ts,
  });
  for (let e = 0; e < epics; e++) {
    await writeFixture(join(path, `plugins/epics/epic-${e}.json`), EpicSchema, {
      version: 1,
      id: `epic-${e}`,
      name: `Epic ${e}`,
      description: '',
      closed: e % 10 === 0,
      createdAt: ts,
      updatedAt: ts,
    });
  }
  const specsDir = join(path, 'boards/web/plugins/specs');
  await mkdir(specsDir, { recursive: true });
  for (let s = 0; s < specs; s++) await writeFile(join(specsDir, `spec-${s}.md`), `# Spec ${s}\n\nBody ${s}\n`);
  await writeFile(join(specsDir, 'common.md'), '# Common\n\nShared\n');

  for (let start = 1; start <= stories; start += BATCH) {
    const batch: Promise<unknown>[] = [];
    for (let i = start; i < start + BATCH && i <= stories; i++) {
      const story = fixtureStory(i, { epics, specs });
      batch.push(writeFixture(join(path, 'boards/web/stories', story.key, 'story.json'), StorySchema, story));
    }
    await Promise.all(batch);
  }
}

/** Story `WEB-<i>` of the fixture, with its bags checked by each Plugin's schema. */
export function fixtureStory(i: number, { epics, specs }: { epics: number; specs: number }): Story {
  const ts = FIXED_NOW;
  const key = `WEB-${i}`;
  const comment = (id: string, author: string | null, body: string) => ({
    id,
    author,
    body,
    createdAt: ts,
    updatedAt: ts,
  });
  const linked = specs > 0 ? [`spec-${i % specs}`, 'common'] : ['common'];
  return {
    version: 1,
    key,
    boardId: 'web',
    name: `Story ${i}`,
    description: `Description of story ${i}. `.repeat(3),
    stage: STAGES[i % STAGES.length] as string,
    rank: `a${i.toString(36).padStart(5, '0')}`,
    priority: i % 5 === 0 ? 'P1' : null,
    labels: i % 7 === 0 ? ['bug'] : [],
    dueDate: null,
    customFields: {},
    createdBy: null,
    createdAt: ts,
    updatedAt: ts,
    plugins: {
      tasks: TasksBag.parse({
        nextNumber: 2,
        tasks: [{ number: 1, name: 'Task', description: '', stage: 'todo', createdAt: ts, updatedAt: ts }],
      }),
      ...(epics > 0 ? { epics: EpicBag.parse({ epic: `epic-${i % epics}` }) } : {}),
      specs: SpecsBag.parse({ specs: linked }),
      comments: CommentsBag.parse({ comments: [comment('a1', 'alice', 'first'), comment('a2', null, 'second')] }),
    },
  };
}
