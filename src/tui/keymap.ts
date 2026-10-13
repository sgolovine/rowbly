import type { Key } from 'ink';

/** One key and what it does, as shown in the footer and the help overlay. */
export interface KeyHint {
  key: string;
  description: string;
}

/** The keys the shell handles on every screen. */
export const GLOBAL_KEYS: readonly KeyHint[] = [
  { key: '↑/↓ j/k', description: 'move' },
  { key: 'enter', description: 'select' },
  { key: '/', description: 'filter lists' },
  { key: 'esc', description: 'back' },
  { key: 'g', description: 'go to' },
  { key: '?', description: 'help' },
  { key: 'q', description: 'quit (from the root)' },
];

/** A place the `g` palette and the home menu can open. */
export interface Destination {
  label: string;
  screen: string;
  params?: Record<string, unknown>;
}

export const DESTINATIONS: readonly Destination[] = [
  { label: 'Board', screen: 'board' },
  { label: 'Stories', screen: 'stories' },
  { label: 'Epics', screen: 'epics' },
  { label: 'Workspaces', screen: 'workspaces' },
  { label: 'Boards', screen: 'boards' },
  { label: 'Assignees', screen: 'assignees' },
  { label: 'Stages', screen: 'stages' },
  { label: 'Fields', screen: 'fields' },
  // The Board detail, which shows the effective configuration (`config show`).
  { label: 'Config', screen: 'board-detail', params: { title: 'Config' } },
  { label: 'Context', screen: 'context' },
  { label: 'Doctor', screen: 'doctor' },
];

export type GlobalAction = 'quit' | 'back' | 'help' | 'goto';

/** The shell action bound to a key press, if any. */
export function globalAction(input: string, key: Key): GlobalAction | null {
  if (key.escape) return 'back';
  if (key.ctrl || key.meta) return null;
  if (input === 'q') return 'quit';
  if (input === '?') return 'help';
  if (input === 'g') return 'goto';
  return null;
}

/** Arrow keys and `j`/`k` both move. Pass `vim: false` where `j`/`k` are typed text. */
export function moveDelta(input: string, key: Key, vim = true): -1 | 0 | 1 {
  if (key.upArrow || (vim && input === 'k')) return -1;
  if (key.downArrow || (vim && input === 'j')) return 1;
  return 0;
}
