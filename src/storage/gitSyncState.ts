import { hostname } from 'node:os';
import { z } from 'zod';
import { readTextIfExists } from './files';
import { writeTextFile } from './system';

const Last = z.object({
  id: z.string().optional(),
  kind: z.enum(['synchronized', 'failed', 'interrupted']),
  message: z.string(),
  startedAt: z.number(),
  finishedAt: z.number(),
  commit: z.string().optional(),
  upstream: z.string().optional(),
  evidence: z.array(z.string()).default([]),
  repairs: z.number().default(0),
});
const State = z.object({
  version: z.literal(1),
  anchor: z.number(),
  nextDue: z.number(),
  intervalSeconds: z.number(),
  requested: z.string().optional(),
  target: z.object({ branch: z.string(), remote: z.string(), mergeRef: z.string() }).optional(),
  active: z
    .object({ id: z.string(), pid: z.number(), host: z.string(), startedAt: z.number(), phase: z.string() })
    .optional(),
  last: Last.optional(),
});
export type GitSyncState = z.infer<typeof State>;
export function localHost(): string {
  return hostname();
}
export function syncProcessAlive(pid: number, host: string): boolean {
  if (host !== hostname()) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}
export async function readSyncState(file: string): Promise<GitSyncState | null> {
  const text = await readTextIfExists(file);
  return text === null ? null : State.parse(JSON.parse(text));
}
export async function writeSyncState(file: string, value: GitSyncState): Promise<void> {
  await writeTextFile(file, JSON.stringify(State.parse(value)));
}
