import {
  type GitCommitOptions,
  type GitSyncOptions,
  type PluginContext,
  type PluginReadContext,
  ValidationError,
  z,
} from '../../plugin-api';

export const Preferences = z.strictObject({
  automaticCommits: z.boolean().default(true),
  synchronization: z
    .strictObject({
      enabled: z.boolean().default(false),
      intervalSeconds: z.number().int().min(1).max(86400).default(300),
    })
    .default({ enabled: false, intervalSeconds: 300 }),
  frequency: z.enum(['change', 'interval']).default('change'),
  intervalSeconds: z.number().int().min(1).max(86400).default(300),
  authorName: z
    .string()
    .trim()
    .min(1)
    .regex(/^[^<>\r\n]+$/)
    .optional(),
  authorEmail: z.string().trim().email().optional(),
});

export type GitPreferences = z.output<typeof Preferences>;

export async function preferences(plugin: Pick<PluginReadContext, 'localData'>): Promise<GitPreferences> {
  return resolvePreferences(await plugin.localData());
}

/** Parses the current bag supplied by the host at scheduling and worker admission. */
export function resolvePreferences(localData: unknown): GitPreferences {
  const result = Preferences.safeParse(localData ?? {});
  if (!result.success)
    throw new ValidationError('Git commit preferences are invalid', { details: { issues: result.error.issues } });
  return result.data;
}

export async function configure(plugin: PluginContext, input: unknown): Promise<GitPreferences> {
  const patch = z
    .strictObject({
      automaticCommits: Preferences.shape.automaticCommits.removeDefault().optional(),
      frequency: Preferences.shape.frequency.removeDefault().optional(),
      intervalSeconds: Preferences.shape.intervalSeconds.removeDefault().optional(),
      synchronization: z
        .strictObject({
          enabled: z.boolean().optional(),
          intervalSeconds: z.number().int().min(1).max(86400).optional(),
        })
        .optional(),
      authorName: Preferences.shape.authorName,
      authorEmail: Preferences.shape.authorEmail,
    })
    .safeParse(input);
  if (!patch.success)
    throw new ValidationError('Git preferences are invalid', { details: { issues: patch.error.issues } });
  return plugin.operation('configure', patch.data, async (changes) => {
    let value!: GitPreferences;
    await changes.updateLocalState((local) => {
      // Read and merge inside the Operation, so independent settings cannot erase each other.
      const old = resolvePreferences(local.plugins?.[plugin.id]);
      value = Preferences.parse({
        ...old,
        ...patch.data,
        synchronization: { ...old.synchronization, ...patch.data.synchronization },
      });
      return plugin.writeBag(local, value);
    });
    return value;
  });
}

/** Project legacy commit options independently of synchronization preferences. */
export function resolveCommitOptions(localData: unknown): GitCommitOptions {
  const { synchronization: _synchronization, ...options } = resolvePreferences(localData);
  return options;
}

export function resolveSyncOptions(localData: unknown): GitSyncOptions {
  const prefs = resolvePreferences(localData);
  return { ...prefs.synchronization, authorName: prefs.authorName, authorEmail: prefs.authorEmail };
}
