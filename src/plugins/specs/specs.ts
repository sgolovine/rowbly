import {
  type Bagged,
  ConflictError,
  DataIntegrityError,
  type FileScope,
  isSlug,
  NotFoundError,
  type PluginChangeSet,
  type PluginChangeSetView,
  type PluginContext,
  type PluginHookContext,
  type PluginReadContext,
  SlugSchema,
  type Story,
  toTimestamp,
  UsageError,
  ValidationError,
  z,
} from '../../plugin-api';

export const SpecsBag = z.object({ specs: z.array(SlugSchema) });
export const SpecsInput = z.object({
  specs: z.array(SlugSchema).optional(),
  addSpecs: z.array(SlugSchema).optional(),
  removeSpecs: z.array(SlugSchema).optional(),
  /** Replace the stored links even when they are invalid (an explicit reset); `specs` is the new set. */
  reset: z.literal(true).optional(),
});
export type SpecsInput = z.infer<typeof SpecsInput>;

/** A Story Spec (`story`) or a Board Spec (`slug`) on `board`. */
export type SpecTarget =
  | { board: string; story: string; slug?: never }
  | { board: string; slug: string; story?: never };
export type BoardSpecTarget = Extract<SpecTarget, { slug: string }>;

export interface StorySpec {
  title: string;
  text: string;
}

export interface BoardSpec extends StorySpec {
  slug: string;
}

export type Spec = StorySpec | BoardSpec;

/** The params of the Spec form: a draft Board Spec (its slug comes from the form), a draft Story Spec, or an edit. */
export type SpecFormParams = { create: true; board: string; story?: string } | { create: false; target: SpecTarget };

export const STORY_SPEC_FILE = 'spec.md';
const HEADING = /^# .*$/m;

export function boardSpecFile(slug: string): string {
  return `${slug}.md`;
}

/** What a target is called in messages: the Story Key or the slug. */
export function specTargetName(target: SpecTarget): string {
  return target.story ?? target.slug;
}

/** A Board Spec as one line: `<slug>  <title>`. */
export function specLine(spec: BoardSpec): string {
  return `${spec.slug}  ${spec.title}`;
}

export function specTitle(text: string): string {
  return /^# (.*)\r?$/m.exec(text)?.[1]?.trim() ?? '';
}

export function titledText(text: string, title?: string): string {
  if (title === undefined) return text;
  if (!title.trim() || /[\r\n]/.test(title)) throw new UsageError('A Spec title must be one nonempty line');
  return HEADING.test(text) ? text.replace(HEADING, () => `# ${title.trim()}`) : `# ${title.trim()}\n\n${text}`;
}

/**
 * Specs input, checked: a malformed value is a `ValidationError` with its issues, and `specs` (or
 * `reset`) together with `addSpecs`/`removeSpecs` is a `UsageError`.
 */
export function parseSpecsInput(value: unknown): SpecsInput {
  const result = SpecsInput.safeParse(value);
  if (!result.success) {
    const summary = result.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
    throw new ValidationError(`Invalid Specs input: ${summary}`, { details: { issues: result.error.issues } });
  }
  const input = result.data;
  if ((input.specs || input.reset) && (input.addSpecs || input.removeSpecs))
    throw new UsageError('Use --spec alone, or --add-spec and --remove-spec');
  return input;
}

/** Checks a screen's Spec target params, which `ui.open` does not check. */
export function parseSpecTarget(params: Record<string, unknown>): SpecTarget {
  const { board, story, slug } = params;
  if (typeof board !== 'string' || !board) throw new UsageError('A Spec needs a Board');
  if (story !== undefined && slug !== undefined) throw new UsageError('A Spec names a Story or a slug, not both');
  if (typeof story === 'string' && story) return { board, story };
  if (typeof slug === 'string' && isSlug(slug)) return { board, slug };
  throw new UsageError('A Spec needs a Story Key or a lower-kebab-case Board Spec slug');
}

/** Checks the Spec form's params: `create: true` for a draft, `create: false` with a whole target to edit. */
export function parseSpecFormParams(params: Record<string, unknown>): SpecFormParams {
  if (params.create === false) return { create: false, target: parseSpecTarget(params) };
  if (params.create !== true) throw new UsageError('The Spec form needs create: true or false');
  const { board, story, slug } = params;
  if (typeof board !== 'string' || !board) throw new UsageError('A Spec needs a Board');
  if (slug !== undefined) throw new UsageError('A new Board Spec gets its slug in the form');
  if (story === undefined) return { create: true, board };
  if (typeof story !== 'string' || !story) throw new UsageError('A Story Spec needs a Story Key');
  return { create: true, board, story };
}

function location(target: SpecTarget): { scope: FileScope; name: string } {
  if (target.story !== undefined) return { scope: { story: target.story }, name: STORY_SPEC_FILE };
  if (!isSlug(target.slug)) throw new UsageError('A Board Spec needs a lower-kebab-case slug');
  return { scope: { board: target.board }, name: boardSpecFile(target.slug) };
}

function toSpec(target: SpecTarget, text: string): Spec {
  return target.story !== undefined
    ? { title: specTitle(text), text }
    : { slug: target.slug, title: specTitle(text), text };
}

export async function resolveTarget(
  plugin: PluginContext,
  slug: string | undefined,
  opts: { board?: string; story?: string },
  resolveBoard: (flag?: string) => Promise<string>,
): Promise<SpecTarget> {
  if (opts.story) {
    if (slug || opts.board) throw new UsageError('Use --story alone to name a Story Spec');
    const story = await plugin.services.stories.get(opts.story);
    return { board: story.boardId, story: story.key };
  }
  if (!slug || !isSlug(slug)) throw new UsageError('A Board Spec needs a lower-kebab-case slug');
  const target = { board: await resolveBoard(opts.board), slug };
  await plugin.services.boards.get(target.board);
  return target;
}

export async function readSpec(plugin: PluginReadContext, target: BoardSpecTarget): Promise<BoardSpec | null>;
export async function readSpec(plugin: PluginReadContext, target: SpecTarget): Promise<Spec | null>;
export async function readSpec(plugin: PluginReadContext, target: SpecTarget): Promise<Spec | null> {
  const { scope, name } = location(target);
  const text = await plugin.files.read(scope, name);
  return text === null ? null : toSpec(target, text);
}

export async function getSpec(plugin: PluginReadContext, target: SpecTarget): Promise<Spec> {
  const spec = await readSpec(plugin, target);
  if (!spec) throw new NotFoundError(`Spec "${specTargetName(target)}" not found`);
  return spec;
}

/**
 * The slugs of the Board's Board Specs, from file names only: top-level `<slug>.md` files. For
 * controls and checks that need no titles or text.
 */
export async function listSpecSlugs(plugin: PluginHookContext, board: string): Promise<string[]> {
  await plugin.services.boards.get(board);
  return (await plugin.files.list({ board }))
    .filter((name) => name.endsWith('.md') && isSlug(name.slice(0, -3)))
    .map((name) => name.slice(0, -3));
}

export async function listSpecs(plugin: PluginHookContext, board: string): Promise<BoardSpec[]> {
  const specs: BoardSpec[] = [];
  for (const slug of await listSpecSlugs(plugin, board)) {
    const spec = await readSpec(plugin, { board, slug });
    if (spec) specs.push(spec);
  }
  return specs;
}

export function createSpec(plugin: PluginContext, target: SpecTarget, text: string): Promise<Spec> {
  return writeSpec(plugin, target, text, 'create');
}

export function editSpec(plugin: PluginContext, target: SpecTarget, text: string): Promise<Spec> {
  return writeSpec(plugin, target, text, 'edit');
}

async function writeSpec(
  plugin: PluginContext,
  target: SpecTarget,
  text: string,
  mode: 'create' | 'edit',
): Promise<Spec> {
  const { scope, name } = location(target);
  if (!specTitle(text)) throw new UsageError('A Spec needs a nonempty # heading for its title');
  // Resolve the containing record before preparing the operation, so that a missing Story or Board
  // is reported as itself before any change is collected.
  if (target.story !== undefined) await plugin.services.stories.get(target.story);
  else await plugin.services.boards.get(target.board);
  return plugin.operation(
    mode,
    { ...target, text },
    async (changes) => {
      const before = await changes.readFile(scope, name);
      if (mode === 'create' && before !== null)
        throw new ConflictError(`Spec "${specTargetName(target)}" already exists`);
      if (mode === 'edit' && before === null) throw new NotFoundError(`Spec "${specTargetName(target)}" not found`);
      await changes.writeFile(scope, name, text);
      return toSpec(target, text);
    },
    // The Spec as saved, after other Plugins' transforms (ARCH-42).
    { result: (changes) => savedSpec(changes, target, scope, name) },
  );
}

async function savedSpec(changes: PluginChangeSetView, target: SpecTarget, scope: FileScope, name: string) {
  const text = await changes.readFile(scope, name);
  if (text === null) throw new ConflictError(`Spec "${specTargetName(target)}" was removed before it was saved`);
  return toSpec(target, text);
}

/** The Story's links for display and filters; an invalid bag shows as none (doctor reports it). */
export function linkedSpecs(plugin: PluginReadContext, story: Bagged): string[] {
  return plugin.readBag(story, SpecsBag)?.specs ?? [];
}

/** The Story's links for a change: an invalid bag throws `DATA_INTEGRITY` instead of reading as none. */
function storedSpecs(plugin: PluginReadContext, story: Bagged): string[] {
  try {
    return plugin.requireBag(story, SpecsBag)?.specs ?? [];
  } catch (err) {
    if (!(err instanceof DataIntegrityError)) throw err;
    throw new DataIntegrityError(err.message, {
      details: err.details,
      hint: 'run `rowbly doctor`, or replace the links with `stories edit <KEY> --reset-specs [--spec <slug>]`',
    });
  }
}

export function setSpecs(plugin: PluginReadContext, story: Story, specs: string[]): Story {
  return plugin.writeBag(story, specs.length ? { specs: [...new Set(specs)] } : undefined);
}

/**
 * The Story without links to `slugs`, stamped with the operation clock; the Story itself when it
 * links to none of them. Used by Spec deletion and doctor, which change no core field (W8).
 */
export function withoutSpecs(plugin: PluginReadContext, story: Story, slugs: readonly string[]): Story {
  const links = storedSpecs(plugin, story);
  const kept = links.filter((slug) => !slugs.includes(slug));
  if (kept.length === links.length) return story;
  return { ...setSpecs(plugin, story, kept), updatedAt: toTimestamp(plugin.now()) };
}

export async function deleteSpec(plugin: PluginContext, target: SpecTarget): Promise<number> {
  const { scope, name } = location(target);
  const unlinked = await plugin.operation('delete', target, async (changes) => {
    if ((await changes.readFile(scope, name)) === null)
      throw new NotFoundError(`Spec "${specTargetName(target)}" not found`);
    await changes.deleteFile(scope, name);
    if (target.story !== undefined) return 0;
    let count = 0;
    for (const story of await plugin.services.stories.list(target.board, {})) {
      const links = storedSpecs(plugin, story);
      if (!links.includes(target.slug)) continue;
      await changes.updateStory(story.key, (s) => withoutSpecs(plugin, s, [target.slug]));
      count++;
    }
    return count;
  });
  if (unlinked) plugin.warn(`Unlinked Board Spec "${target.slug}" from ${unlinked} Stories`);
  return unlinked;
}

/** Applies Specs input to Story `key`. Adding and removing need readable links; `reset` replaces whatever is stored. */
export async function applySpecs(changes: PluginChangeSet, key: string, input: unknown, plugin: PluginReadContext) {
  if (input === undefined) return;
  const parsed = parseSpecsInput(input);
  await changes.updateStory(key, (story) => {
    const stored = parsed.reset ? [] : storedSpecs(plugin, story);
    const slugs = parsed.specs ?? stored;
    return setSpecs(
      plugin,
      story,
      [...slugs, ...(parsed.addSpecs ?? [])].filter((s) => !parsed.removeSpecs?.includes(s)),
    );
  });
}
