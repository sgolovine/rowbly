import type { ConfigLevel } from '../schemas';

/** The Configuration Cascade level a Board's effective Stages or Custom Fields come from, e.g. `from board`. */
export function describeSource(level: ConfigLevel): string {
  return `from ${level}`;
}
