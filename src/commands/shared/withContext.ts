import type { Command } from 'commander';
import type { CommandEnv } from './runWithContext';
import { runWithContext } from './runWithContext';

export function withContext<T>(cmd: Command, fn: (env: CommandEnv) => Promise<T>): Promise<T> {
  return runWithContext(cmd, false, (env) => fn(env as CommandEnv));
}
