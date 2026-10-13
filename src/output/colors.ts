import pc from 'picocolors';
import type { StageCategory } from '../schemas';

/** picocolors honours NO_COLOR / FORCE_COLOR and TTY detection. */
export const colors = pc;

const categoryColors: Record<StageCategory, (text: string) => string> = {
  todo: pc.dim,
  in_progress: pc.yellow,
  done: pc.green,
};

/** Colours text by Stage Category: todo dim, in_progress yellow, done green. */
export function colorByCategory(category: StageCategory, text: string): string {
  return categoryColors[category](text);
}
