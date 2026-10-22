import { confirm, isCancel } from '@clack/prompts';
import { UsageError } from '../../core';
import { cancelled } from './cancelled';
import type { GlobalOptions } from './globalOptions';
import { isInteractive } from './isInteractive';

/** Asks before a destructive action; `--yes` skips the question. */
export async function confirmDestructive(message: string, globals: GlobalOptions): Promise<void> {
  if (globals.yes) return;
  if (!isInteractive(globals))
    throw new UsageError(`${message} — confirmation required`, { hint: 'pass --yes to confirm' });
  const answer = await confirm({ message, initialValue: false });
  if (isCancel(answer) || !answer) cancelled();
}
