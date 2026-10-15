import {
  type Bagged,
  ConflictError,
  type FileScope,
  isSlug,
  NotFoundError,
  type PluginChangeSet,
  type PluginContext,
  type PluginHookContext,
  type PluginReadContext,
  SlugSchema,
  type Story,
  UsageError,
  z,
} from '../../plugin-api';

export const SpecsBag = z.object({ specs: z.array(SlugSchema) });
export const SpecsInput = z.object({
  specs: z.array(SlugSchema).optional(),
  addSpecs: z.array(SlugSchema).optional(),
  removeSpecs: z.array(SlugSchema).optional(),
});

export interface SpecTarget {
  board: string;
  story?: string;
  slug?: string;
}

export interface Spec {
  title: string;
  text: string;
  slug?: string;
}

export function specTitle(text: string): string {
  return /^# (.*)\r?$/m.exec(text)?.[1]?.trim() ?? '';
}

export function titledText(text: string, title?: string): string {
  if (title === undefined) return text;
  if (!title.trim() || /[\r\n]/.test(title)) throw new UsageError('A Spec title must be one nonempty line');
  return /^# .*$/m.test(text) ? text.replace(/^# .*$/m, () => `# ${title.trim()}`) : `# ${title.trim()}\n\n${text}`;
}

function location(target: SpecTarget): { scope: FileScope; name: string } {
  if (target.story) return { scope: { story: target.story }, name: 'spec.md' };
  if (!target.slug || !isSlug(target.slug)) throw new UsageError('A Board Spec needs a lower-kebab-case slug');
  return { scope: { board: target.board }, name: `${target.slug}.md` };
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
  const target = { board: await resolveBoard(opts.board), slug };
  location(target);
  await plugin.services.boards.get(target.board);
  return target;
}

export async function readSpec(plugin: PluginReadContext, target: SpecTarget): Promise<Spec | null> {
  const { scope, name } = location(target);
  const text = await plugin.files.read(scope, name);
  return text === null ? null : { title: specTitle(text), text, ...(target.slug ? { slug: target.slug } : {}) };
}

export async function getSpec(plugin: PluginContext, target: SpecTarget): Promise<Spec> {
  const spec = await readSpec(plugin, target);
  if (!spec) throw new NotFoundError(`Spec "${target.story ?? target.slug}" not found`);
  return spec;
}

export async function listSpecs(plugin: PluginHookContext, board: string): Promise<Spec[]> {
  await plugin.services.boards.get(board);
  const names = await plugin.files.list({ board });
  const specs: Spec[] = [];
  for (const name of names) {
    if (!name.endsWith('.md') || !isSlug(name.slice(0, -3))) continue;
    const spec = await readSpec(plugin, { board, slug: name.slice(0, -3) });
    if (spec) specs.push(spec);
  }
  return specs;
}

export async function saveSpec(
  plugin: PluginContext,
  target: SpecTarget,
  text: string,
  create: boolean,
): Promise<Spec> {
  const { scope, name } = location(target);
  if (!specTitle(text)) throw new UsageError('A Spec needs a nonempty # heading for its title');
  // Resolve the containing record before collecting a file change.
  if (target.story) await plugin.services.stories.get(target.story);
  else await plugin.services.boards.get(target.board);
  await plugin.operation(create ? 'create' : 'edit', { ...target, text }, async (changes) => {
    const before = await changes.readFile(scope, name);
    if (create && before !== null) throw new ConflictError(`Spec "${target.story ?? target.slug}" already exists`);
    if (!create && before === null) throw new NotFoundError(`Spec "${target.story ?? target.slug}" not found`);
    await changes.writeFile(scope, name, text);
  });
  return getSpec(plugin, target);
}

export function linkedSpecs(plugin: PluginReadContext, story: Bagged): string[] {
  return plugin.readBag(story, SpecsBag)?.specs ?? [];
}

export function setSpecs(plugin: PluginReadContext, story: Story, specs: string[]): Story {
  return plugin.writeBag(story, specs.length ? { specs: [...new Set(specs)] } : undefined);
}

export async function deleteSpec(plugin: PluginContext, target: SpecTarget): Promise<number> {
  const { scope, name } = location(target);
  let unlinked = 0;
  await plugin.operation('delete', target, async (changes) => {
    if ((await changes.readFile(scope, name)) === null)
      throw new NotFoundError(`Spec "${target.story ?? target.slug}" not found`);
    await changes.deleteFile(scope, name);
    if (!target.story) {
      for (const story of await plugin.services.stories.list(target.board, {})) {
        if (!linkedSpecs(plugin, story).includes(target.slug as string)) continue;
        await changes.updateStory(story.key, (s) =>
          setSpecs(
            plugin,
            s,
            linkedSpecs(plugin, s).filter((slug) => slug !== target.slug),
          ),
        );
        unlinked++;
      }
    }
  });
  if (unlinked) plugin.warn(`Unlinked Board Spec "${target.slug}" from ${unlinked} Stories`);
  return unlinked;
}

export async function applySpecs(changes: PluginChangeSet, key: string, input: unknown, plugin: PluginReadContext) {
  if (input === undefined) return;
  const parsed = SpecsInput.parse(input);
  if (parsed.specs && (parsed.addSpecs || parsed.removeSpecs))
    throw new UsageError('Use --spec alone, or --add-spec and --remove-spec');
  await changes.updateStory(key, (story) => {
    const slugs = parsed.specs ?? linkedSpecs(plugin, story);
    return setSpecs(
      plugin,
      story,
      [...slugs, ...(parsed.addSpecs ?? [])].filter((s) => !parsed.removeSpecs?.includes(s)),
    );
  });
}
