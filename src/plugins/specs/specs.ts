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
export const SpecsCreateInput = SpecsInput.extend({
  storySpecs: z
    .array(
      z.object({
        slug: SlugSchema.default('spec'),
        title: z
          .string()
          .min(1)
          .regex(/^[^\r\n]+$/)
          .optional(),
        text: z.string(),
      }),
    )
    .optional(),
}).superRefine(({ storySpecs }, ctx) => {
  const seen = new Set<string>();
  for (const [i, spec] of (storySpecs ?? []).entries()) {
    if (seen.has(spec.slug))
      ctx.addIssue({
        code: 'custom',
        path: ['storySpecs', i, 'slug'],
        message: `duplicate Story Spec slug "${spec.slug}"`,
      });
    seen.add(spec.slug);
  }
});

/** A Story Spec (`story` and `slug`) or a Board Spec (`slug` alone) on `board`. */
export type SpecTarget =
  | { board: string; story: string; slug: string }
  | { board: string; slug: string; story?: never };

export interface Spec {
  slug: string;
  title: string;
  text: string;
}

/** The params of the Spec form, which only creates: a Board Spec, or a Story Spec of `story`. */
export interface SpecFormParams {
  board: string;
  story?: string;
}

/** The slug of a Story Spec named by its Story alone; `spec.md` was a Story's one Story Spec before ADR-0025. */
export const STORY_SPEC_SLUG = 'spec';
const HEADING = /^# .*$/m;

/** The file of the Spec `slug`, in its Board's or Story's Plugin folder. */
export function specFile(slug: string): string {
  return `${slug}.md`;
}

/** What a target is called in messages: the slug, after the Story Key for a Story Spec (`WEB-1/design`). */
export function specTargetName(target: SpecTarget): string {
  return target.story === undefined ? target.slug : `${target.story}/${target.slug}`;
}

/** A Spec as one line: `<slug>  <title>`. */
export function specLine(spec: Spec): string {
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

/** Checks the Spec form's params, which `ui.open` does not check; a new Spec gets its slug in the form. */
export function parseSpecFormParams(params: Record<string, unknown>): SpecFormParams {
  const { board, story, slug } = params;
  if (typeof board !== 'string' || !board) throw new UsageError('A Spec needs a Board');
  if (slug !== undefined) throw new UsageError('A new Spec gets its slug in the form');
  if (story === undefined) return { board };
  if (typeof story !== 'string' || !story) throw new UsageError('A Story Spec needs a Story Key');
  return { board, story };
}

function location(target: SpecTarget): { scope: FileScope; name: string } {
  if (!isSlug(target.slug)) throw new UsageError('A Spec needs a lower-kebab-case slug');
  const scope = target.story === undefined ? { board: target.board } : { story: target.story };
  return { scope, name: specFile(target.slug) };
}

function toSpec(target: SpecTarget, text: string): Spec {
  return { slug: target.slug, title: specTitle(text), text };
}

/** The slugs of the top-level `<slug>.md` files among `names`. */
function specSlugs(names: readonly string[]): string[] {
  return names.filter((name) => name.endsWith('.md') && isSlug(name.slice(0, -3))).map((name) => name.slice(0, -3));
}

export async function resolveTarget(
  plugin: PluginContext,
  slug: string | undefined,
  opts: { board?: string; story?: string },
  resolveBoard: (flag?: string) => Promise<string>,
): Promise<SpecTarget> {
  if (opts.story) {
    if (opts.board) throw new UsageError('Use --story without --board to name a Story Spec');
    if (slug !== undefined && !isSlug(slug)) throw new UsageError('A Story Spec needs a lower-kebab-case slug');
    const story = await plugin.services.stories.get(opts.story);
    return { board: story.boardId, story: story.key, slug: slug ?? STORY_SPEC_SLUG };
  }
  if (!slug || !isSlug(slug)) throw new UsageError('A Board Spec needs a lower-kebab-case slug');
  const target = { board: await resolveBoard(opts.board), slug };
  await plugin.services.boards.get(target.board);
  return target;
}

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
  return specSlugs(await plugin.files.list({ board }));
}

export async function listSpecs(plugin: PluginHookContext, board: string): Promise<Spec[]> {
  const specs: Spec[] = [];
  for (const slug of await listSpecSlugs(plugin, board)) {
    const spec = await readSpec(plugin, { board, slug });
    if (spec) specs.push(spec);
  }
  return specs;
}

/** The Story Specs of `story`: its top-level `<slug>.md` files. */
export async function listStorySpecs(
  plugin: PluginReadContext,
  story: Pick<Story, 'key' | 'boardId'>,
): Promise<Spec[]> {
  const specs: Spec[] = [];
  for (const slug of specSlugs(await plugin.files.list({ story: story.key }))) {
    const spec = await readSpec(plugin, { board: story.boardId, story: story.key, slug });
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
