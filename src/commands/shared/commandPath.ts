import type { Command } from 'commander';

/** A command's path below the program, e.g. `stories create`. */
export function commandPath(cmd: Command): string {
  const names: string[] = [];
  for (let at: Command | null = cmd; at?.parent; at = at.parent) names.unshift(at.name());
  return names.join(' ');
}
