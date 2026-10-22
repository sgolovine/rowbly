import type { Command } from 'commander';
import type { OptionalCommandEnv } from './runWithContext';
import { runWithContext } from './runWithContext';

export function withOptionalContext<T>(cmd: Command, fn: (env: OptionalCommandEnv) => Promise<T>): Promise<T> {
  return runWithContext(cmd, true, fn);
}
