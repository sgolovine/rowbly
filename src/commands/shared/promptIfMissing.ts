import { isCancel, select, text } from '@clack/prompts';
import { UsageError } from '../../core';
import { cancelled } from './cancelled';
import type { GlobalOptions } from './globalOptions';
import { isInteractive } from './isInteractive';

export interface PromptSpec<T extends string> {
  flag: string;
  message: string;
  options?: { value: T; label?: string; hint?: string }[];
  validate?: (value: string) => string | undefined;
  initialValue?: string;
}

export async function promptIfMissing<T extends string>(
  value: T | undefined,
  globals: GlobalOptions,
  spec: PromptSpec<T>,
): Promise<T> {
  if (value !== undefined) return value;
  if (!isInteractive(globals)) throw new UsageError(`missing required ${spec.flag}`);
  if (spec.options) {
    const answer = await select<T>({
      message: spec.message,
      options: spec.options as Parameters<typeof select<T>>[0]['options'],
    });
    return isCancel(answer) ? cancelled() : answer;
  }
  const answer = await text({
    message: spec.message,
    initialValue: spec.initialValue,
    validate: (input) => (input ? spec.validate?.(input) : `${spec.flag} is required`),
  });
  return isCancel(answer) ? cancelled() : (answer as T);
}
