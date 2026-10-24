import {
  type GitCommitOptions,
  type PluginContext,
  type PluginReadContext,
  ValidationError,
  z,
} from '../../plugin-api';

export const Preferences = z.strictObject({
  automaticCommits: z.boolean().default(true),
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

export async function preferences(plugin: Pick<PluginReadContext, 'localData'>): Promise<GitCommitOptions> {
  return resolvePreferences(await plugin.localData());
}

/** Parses the current bag supplied by the host at scheduling and worker admission. */
export function resolvePreferences(localData: unknown): GitCommitOptions {
  const result = Preferences.safeParse(localData ?? {});
  if (!result.success)
    throw new ValidationError('Git commit preferences are invalid', { details: { issues: result.error.issues } });
  return result.data;
}

export async function configure(plugin: PluginContext, input: unknown): Promise<GitCommitOptions> {
  const result = Preferences.safeParse(input);
  if (!result.success)
    throw new ValidationError('Git commit preferences are invalid', { details: { issues: result.error.issues } });
  const value = result.data;
  return plugin.operation('configure', value, async (changes) => {
    await changes.updateLocalState((local) => plugin.writeBag(local, value));
    return value;
  });
}
