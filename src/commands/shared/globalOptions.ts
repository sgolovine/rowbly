import type { Command } from 'commander';

export interface GlobalOptions {
  root?: string;
  json: boolean;
  yes: boolean;
  /** `false` with `--no-prompt`. */
  prompt: boolean;
}

/** Global flags (contracts §5). */
export function globalOptions(cmd: Command): GlobalOptions {
  const opts = cmd.optsWithGlobals<{ dataRoot?: string; json?: boolean; yes?: boolean; prompt?: boolean }>();
  return { root: opts.dataRoot, json: opts.json ?? false, yes: opts.yes ?? false, prompt: opts.prompt ?? true };
}
