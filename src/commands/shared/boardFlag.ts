export interface ContextFlags {
  board?: string;
}

/** The `flag` argument for `services.context.resolveBoard`: `--board` → `ROWBLY_BOARD` (contracts §4). */
export function boardFlag(opts: ContextFlags, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return opts.board || env.ROWBLY_BOARD || undefined;
}
