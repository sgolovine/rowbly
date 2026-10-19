import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createServices, type DoctorCode, type RowblyContext } from '../../src/services';
import { conflictSides } from '../../src/services/doctor';
import { fixedClock, fixedIds, makeBoard, makeStory, tempRoot } from '../helpers';

const BOARD = 'boards/web';

/** Board `web` (prefix WEB, default stages, one `size` field). */
async function setup() {
  const tmp = await tempRoot();
  const clock = fixedClock();
  const ctx: RowblyContext = {
    root: tmp.root,
    local: { version: 1 },
    me: null,
    now: clock.now,
    newId: fixedIds(),
    warn: () => {},
  };
  await makeBoard(tmp.path, {
    id: 'web',
    keyPrefix: 'WEB',
    customFields: [{ key: 'size', name: 'Size', type: 'number', required: false, integer: true }],
  });
  const story = (key: string, overrides: Parameters<typeof makeStory>[1] extends infer T ? Partial<T> : never = {}) =>
    makeStory(tmp.path, { key, boardId: 'web', rank: `a${key.split('-')[1]}`, ...overrides });
  const read = async (rel: string) => JSON.parse(await readFile(join(tmp.path, rel), 'utf8'));
  const write = async (rel: string, text: string) => {
    await mkdir(dirname(join(tmp.path, rel)), { recursive: true });
    await writeFile(join(tmp.path, rel), text);
  };
  const storyFiles = async () => (await readdir(join(tmp.path, BOARD, 'stories'))).sort();
  const services = createServices(ctx);
  return { tmp, clock, ctx, services, doctor: services.doctor, story, read, write, storyFiles };
}

type Doctor = Awaited<ReturnType<typeof setup>>['doctor'];

const codes = async (doctor: Doctor) => (await doctor.check()).findings.map((f) => f.code);

/** Fixes, expects `code` gone, and checks that a second fix changes nothing. */
async function expectFixed(doctor: Doctor, code: DoctorCode) {
  const report = await doctor.fix();
  expect(report.fixed.map((f) => f.code)).toContain(code);
  expect(report.findings.map((f) => f.code)).not.toContain(code);
  const again = await doctor.fix();
  expect(again.fixed).toEqual([]);
  return report;
}

describe('doctor service', () => {
  it('finds nothing in a healthy Data Root', async () => {
    const { doctor, story } = await setup();
    await story('WEB-1', { labels: ['ui'], customFields: { size: 3 } });
    expect(await doctor.check()).toEqual({ findings: [], fixed: [], summary: { errors: 0, warnings: 0, info: 0 } });
  });

  it('reports schema failures, bad JSON and id/path mismatches', async () => {
    const { doctor, story, write } = await setup();
    await story('WEB-1');
    await write(`${BOARD}/stories/WEB-1/story.json`, '{ "version": 1, "key": "WEB-1" }\n');
    await write(`${BOARD}/board.config.json`, '{ nope');
    const report = await doctor.check();
    const byPath = Object.fromEntries(report.findings.map((f) => [f.path, f]));
    expect(byPath[`${BOARD}/stories/WEB-1/story.json`]).toMatchObject({ code: 'SCHEMA_INVALID', severity: 'error' });
    expect(byPath[`${BOARD}/stories/WEB-1/story.json`]?.details?.issues).toBeInstanceOf(Array);
    expect(byPath[`${BOARD}/board.config.json`]).toMatchObject({
      code: 'SCHEMA_INVALID',
      message: 'file is not valid JSON',
    });
  });

  it('reports a Story whose key or Board does not match its path', async () => {
    const { doctor, story, write } = await setup();
    const s = await story('WEB-1');
    await write(`${BOARD}/stories/WEB-7/story.json`, JSON.stringify({ ...s, key: 'WEB-8' }));
    await write(`${BOARD}/stories/WEB-9/story.json`, JSON.stringify({ ...s, key: 'WEB-9', boardId: 'api' }));
    const report = await doctor.check();
    expect(report.findings).toEqual([
      expect.objectContaining({ code: 'ID_PATH_MISMATCH', path: `${BOARD}/stories/WEB-7/story.json`, fixable: false }),
      expect.objectContaining({ code: 'ID_PATH_MISMATCH', path: `${BOARD}/stories/WEB-9/story.json`, fixable: false }),
    ]);
  });

  it('reports conflict markers in other files and duplicate prefixes', async () => {
    const { doctor, write, tmp } = await setup();
    await write('local.json', '<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> other\n');
    await makeBoard(tmp.path, { id: 'one', keyPrefix: 'API' });
    await makeBoard(tmp.path, { id: 'two', keyPrefix: 'API' });
    const report = await doctor.check();
    expect(report.findings).toContainEqual(expect.objectContaining({ code: 'CONFLICT_MARKERS', path: 'local.json' }));
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        code: 'DUPLICATE_PREFIX',
        path: 'boards/two/board.config.json',
        message: 'key prefix API is used by one, two',
      }),
    );
  });

  it('reports unknown Stages on Stories', async () => {
    const { doctor, story } = await setup();
    await story('WEB-1', { stage: 'gone' });
    const report = await doctor.check();
    expect(report.findings.map((f) => [f.code, f.message, f.fixable])).toEqual([
      ['UNKNOWN_STAGE', 'WEB-1 is in unknown Stage "gone"', false],
    ]);
    expect(report.findings[0]?.details?.hint).toBe('run `rowbly stories move WEB-1 <stage>`');
  });

  it('fixes an add/add Story Key conflict by renumbering the later Story', async () => {
    const { doctor, story, read, write, storyFiles, clock } = await setup();
    for (const key of ['WEB-1', 'WEB-2', 'WEB-3']) await story(key, { rank: `a${key.at(-1)}` });
    const first = await story('WEB-4', { name: 'Login', rank: 'a4', createdAt: '2026-10-12T10:00:00.000Z' });
    const second = {
      ...first,
      name: 'Signup',
      createdAt: '2026-10-12T11:00:00.000Z',
    };
    // `theirs` is the earlier Story here, so the order of the sides must not matter.
    await write(`${BOARD}/stories/WEB-4/story.json`, conflictText(second, first));
    expect(await codes(doctor)).toEqual(['STORY_KEY_CONFLICT']);

    clock.set('2026-10-13T00:00:00.000Z');
    const report = await expectFixed(doctor, 'STORY_KEY_CONFLICT');
    expect(report.fixed).toEqual([
      {
        code: 'STORY_KEY_CONFLICT',
        path: `${BOARD}/stories/WEB-4/story.json`,
        message: 'kept WEB-4 ("Login") and renumbered "Signup" to WEB-5',
      },
      expect.objectContaining({
        code: 'DUPLICATE_RANK',
        message: 're-ranked WEB-5 in Stage "backlog", keeping the current order',
      }),
    ]);
    expect(report.summary).toEqual({ errors: 0, warnings: 0, info: 0 });
    expect(await storyFiles()).toEqual(['WEB-1', 'WEB-2', 'WEB-3', 'WEB-4', 'WEB-5']);
    expect(await read(`${BOARD}/stories/WEB-4/story.json`)).toEqual(first);
    const renumbered = await read(`${BOARD}/stories/WEB-5/story.json`);
    expect(renumbered).toMatchObject({ key: 'WEB-5', name: 'Signup', updatedAt: '2026-10-13T00:00:00.000Z' });
    expect(renumbered.rank > first.rank).toBe(true);
  });

  it('treats a conflict between two edits of one Story as a manual merge', async () => {
    const { doctor, story, write } = await setup();
    const s = await story('WEB-1');
    await write(`${BOARD}/stories/WEB-1/story.json`, conflictText({ ...s, name: 'Ours' }, { ...s, name: 'Theirs' }));
    const report = await doctor.fix();
    expect(report.fixed).toEqual([]);
    expect(report.findings.map((f) => [f.code, f.fixable])).toEqual([['CONFLICT_MARKERS', false]]);
  });

  it('fixes duplicate keys by renumbering the Story created later', async () => {
    const { doctor, story, read, write, storyFiles } = await setup();
    const early = await story('WEB-2', { name: 'Early', rank: 'a1', createdAt: '2026-10-01T00:00:00.000Z' });
    // A later Story sits at WEB-2's path, while the earlier one was copied to WEB-3's path.
    const late = { ...early, name: 'Late', rank: 'a2', createdAt: '2026-10-02T00:00:00.000Z' };
    await write(`${BOARD}/stories/WEB-2/story.json`, JSON.stringify(late));
    await write(`${BOARD}/stories/WEB-3/story.json`, JSON.stringify(early));
    expect(await codes(doctor)).toEqual(['DUPLICATE_KEY']);

    const report = await expectFixed(doctor, 'DUPLICATE_KEY');
    expect(report.fixed.map((f) => f.message)).toEqual(['renumbered WEB-2 ("Late") to WEB-4']);
    expect(report.findings).toEqual([]);
    expect(await storyFiles()).toEqual(['WEB-2', 'WEB-4']);
    expect(await read(`${BOARD}/stories/WEB-2/story.json`)).toMatchObject({ key: 'WEB-2', name: 'Early' });
    expect(await read(`${BOARD}/stories/WEB-4/story.json`)).toMatchObject({ key: 'WEB-4', name: 'Late' });
  });

  it('strips unknown Custom Fields and only reports invalid or missing values', async () => {
    const { doctor, story, read, tmp } = await setup();
    await makeBoard(tmp.path, {
      id: 'web',
      keyPrefix: 'WEB',
      customFields: [
        { key: 'size', name: 'Size', type: 'number', required: false, integer: true },
        { key: 'team', name: 'Team', type: 'text', required: true },
      ],
    });
    await story('WEB-1', { customFields: { size: 2.5, color: 'red', team: 'core' } });
    await story('WEB-2', { customFields: { size: 1 } });
    expect((await doctor.check()).findings.map((f) => [f.code, f.message])).toEqual([
      ['INVALID_FIELD_VALUE', 'WEB-1: Size must be a whole number'],
      ['UNKNOWN_FIELD', 'WEB-1 has a value for unknown Custom Field "color"'],
      ['MISSING_REQUIRED_FIELD', 'WEB-2 has no value for required Custom Field "team"'],
    ]);
    const report = await expectFixed(doctor, 'UNKNOWN_FIELD');
    expect(report.findings.map((f) => f.code)).toEqual(['INVALID_FIELD_VALUE', 'MISSING_REQUIRED_FIELD']);
    expect((await read(`${BOARD}/stories/WEB-1/story.json`)).customFields).toEqual({ size: 2.5, team: 'core' });
  });

  it('re-ranks only the Stories that share a Rank, keeping their order', async () => {
    const { doctor, story, read } = await setup();
    await story('WEB-1', { rank: 'a0' });
    await story('WEB-2', { rank: 'a1' });
    await story('WEB-3', { rank: 'a1' });
    await story('WEB-4', { rank: 'a2' });
    await story('WEB-5', { rank: 'a1', stage: 'todo' });
    expect((await doctor.check()).findings).toEqual([
      expect.objectContaining({
        code: 'DUPLICATE_RANK',
        path: BOARD,
        message: 'Stories in Stage "backlog" share a Rank: WEB-2, WEB-3',
      }),
    ]);
    await expectFixed(doctor, 'DUPLICATE_RANK');
    const rank = async (key: string) => (await read(`${BOARD}/stories/${key}/story.json`)).rank as string;
    expect(await rank('WEB-2')).toBe('a1');
    const third = await rank('WEB-3');
    expect('a1' < third && third < 'a2').toBe(true);
    expect(await rank('WEB-4')).toBe('a2');
  });

  it('clears stale Local State entries', async () => {
    const { doctor, read, write } = await setup();
    // A missing Board is cleared; core does not check Me against anything, so it is kept.
    await write('local.json', JSON.stringify({ version: 1, board: 'gone', me: 'sam' }));
    const report = await doctor.check();
    expect(report.findings.map((f) => [f.code, f.path, f.message])).toEqual([
      ['STALE_LOCAL_STATE', 'local.json', 'current Board "gone" does not exist'],
    ]);
    await expectFixed(doctor, 'STALE_LOCAL_STATE');
    expect(await read('local.json')).toEqual({ version: 1, me: 'sam' });

    // Valid entries are left alone.
    await write('local.json', JSON.stringify({ version: 1, board: 'web', me: 'sam' }));
    expect(await codes(doctor)).toEqual([]);
  });

  it('reports files outside the layout and folders missing their config', async () => {
    const { doctor, write, tmp } = await setup();
    await write('notes.txt', 'hi');
    await write(`${BOARD}/stories/readme.md`, 'hi');
    await makeStory(tmp.path, { key: 'API-1', boardId: 'api' });
    const report = await doctor.check();
    expect(report.findings.map((f) => [f.severity, f.code, f.path])).toEqual([
      ['error', 'SCHEMA_INVALID', 'boards/api/board.config.json'],
      ['info', 'UNKNOWN_FILE', `${BOARD}/stories/readme.md`],
      ['info', 'UNKNOWN_FILE', 'notes.txt'],
    ]);
    expect(report.summary).toEqual({ errors: 1, warnings: 0, info: 2 });
  });
});

describe('conflictSides', () => {
  it('splits merge and diff3 conflicts and rejects unterminated ones', () => {
    expect(conflictSides('a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> x\nd')).toEqual(['a\nb\nd', 'a\nc\nd']);
    expect(conflictSides('<<<<<<< HEAD\nb\n||||||| base\nz\n=======\nc\n>>>>>>> x')).toEqual(['b', 'c']);
    expect(conflictSides('<<<<<<< HEAD\nb\n=======\nc')).toBeNull();
  });
});

/** A whole-file add/add conflict between two Stories. */
function conflictText(ours: object, theirs: object): string {
  const json = (value: object) => JSON.stringify(value, null, 2);
  return `<<<<<<< HEAD\n${json(ours)}\n=======\n${json(theirs)}\n>>>>>>> other\n`;
}
