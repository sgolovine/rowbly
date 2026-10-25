import { hostname } from 'node:os';
import { z } from 'zod';
import { readTextIfExists } from './files';
import { writeTextFile } from './system';

const Last = z.object({
  id: z.string().optional(),
  mode: z.enum(['merge', 'rebase']).default('merge'),
  kind: z.enum(['synchronized', 'failed', 'interrupted']),
  message: z.string(),
  startedAt: z.number(),
  finishedAt: z.number(),
  commit: z.string().optional(),
  upstream: z.string().optional(),
  evidence: z.array(z.string()).default([]),
  repairs: z.number().default(0),
  pushed: z.boolean().optional(),
});
const Target = z.object({ branch: z.string(), remote: z.string(), mergeRef: z.string() });
const Receipt = Last.extend({ id: z.string().regex(/^[a-f0-9]{32}$/), mode: z.literal('rebase'), pushed: z.boolean() });
const State = z.object({
  version: z.literal(1),
  anchor: z.number(),
  nextDue: z.number(),
  intervalSeconds: z.number(),
  requested: z.string().optional(),
  target: Target.optional(),
  manual: z
    .object({
      id: z.string().regex(/^[a-f0-9]{32}$/),
      pid: z.number(),
      host: z.string(),
      requestedAt: z.number(),
      target: Target,
    })
    .optional(),
  receipts: z.record(z.string().regex(/^[a-f0-9]{32}$/), Receipt).default({}),
  active: z
    .object({
      id: z.string(),
      mode: z.enum(['merge', 'rebase']).default('merge'),
      pid: z.number(),
      host: z.string(),
      startedAt: z.number(),
      phase: z.string(),
    })
    .optional(),
  last: Last.optional(),
});
export type GitSyncState = z.infer<typeof State>;
export type GitSyncReceipt = z.infer<typeof Receipt>;
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
export async function writeSyncState(file: string, value: z.input<typeof State>): Promise<void> {
  await writeTextFile(file, JSON.stringify(State.parse(value)));
}
