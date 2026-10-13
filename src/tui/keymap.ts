import type { Key } from 'ink';

/** One key and what it does, as shown in the footer and the help overlay. */
export interface KeyHint {
  key: string;
  description: string;
  /** Left out of the footer to keep it short; the help overlay still lists it. */
  secondary?: boolean;
}

/** The keys the shell handles on every screen. */
export const GLOBAL_KEYS: readonly KeyHint[] = [
  { key: '↑/↓ j/k', description: 'move' },
  { key: 'enter', description: 'select' },
  { key: '/', description: 'filter lists' },
  { key: '[/]', description: 'previous/next Board' },
  { key: '1-9', description: 'open Board 1-9 in the sidebar' },
  { key: 'N', description: 'new Board' },
  { key: 'esc', description: 'back' },
  { key: ',', description: 'settings' },
  { key: '?', description: 'help' },
  { key: 'q', description: 'quit (from the root)' },
];

/** The keys of a `Form`, for screens that show one. */
export const FORM_KEYS: readonly KeyHint[] = [
  { key: 'tab/enter', description: 'next field' },
  { key: 'shift+tab', description: 'previous field' },
  { key: 'ctrl+enter/ctrl+s', description: 'save' },
];

/** A place the home menu can open. */
export interface Destination {
  label: string;
  screen: string;
  params?: Record<string, unknown>;
}

export const DESTINATIONS: readonly Destination[] = [
  { label: 'Board', screen: 'board' },
  { label: 'Stories', screen: 'stories' },
  { label: 'Boards', screen: 'boards' },
  { label: 'Assignees', screen: 'assignees' },
  { label: 'Stages', screen: 'stages' },
  { label: 'Fields', screen: 'fields' },
  // The Board detail, which shows the effective configuration (`config show`).
  { label: 'Config', screen: 'board-detail', params: { title: 'Config' } },
  { label: 'Context', screen: 'context' },
  { label: 'Doctor', screen: 'doctor' },
];

export type GlobalAction = 'quit' | 'back' | 'help' | 'settings';

/** The shell action bound to a key press, if any. */
export function globalAction(input: string, key: Key): GlobalAction | null {
  if (key.escape) return 'back';
  if (key.ctrl || key.meta) return null;
  if (input === 'q') return 'quit';
  if (input === '?') return 'help';
  if (input === ',') return 'settings';
  return null;
}

/** Arrow keys and `j`/`k` both move. Pass `vim: false` where `j`/`k` are typed text. */
export function moveDelta(input: string, key: Key, vim = true): -1 | 0 | 1 {
  if (key.upArrow || (vim && input === 'k')) return -1;
  if (key.downArrow || (vim && input === 'j')) return 1;
  return 0;
}
