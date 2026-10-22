import type { GlobalOptions } from './globalOptions';

/** Prompting is allowed only with TTY stdin and stdout, and neither `--json` nor `--no-prompt`. */
export function isInteractive(globals: GlobalOptions): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY) && !globals.json && globals.prompt;
}
