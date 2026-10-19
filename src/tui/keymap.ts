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
  { key: '↑/↓', description: 'move' },
  { key: 'enter', description: 'select' },
  { key: '/', description: 'filter lists' },
  { key: '[/]', description: 'previous/next Board' },
  { key: '1-9', description: 'open Board 1-9 in the sidebar' },
  { key: 'N', description: 'new Board' },
  { key: 'esc', description: 'back' },
  { key: ',', description: 'settings' },
  { key: '?', description: 'help' },
  { key: 'q', description: 'quit (from the root)' },
  { key: 'j/k', description: 'move (vim keys)', secondary: true },
];

/**
 * Every key that the shell or a core screen or component handles. A Plugin's Actions must use other
 * keys (ADR-0017), so a Plugin with an Action on one of these fails to load. Add a key here when core
 * starts to handle it: `test/tui/keyReservations.test.ts` fails otherwise (ARCH-13).
 */
export const CORE_KEYS: readonly string[] = [
  // The shell: help, settings, quit, new Board, previous/next Board and Boards 1–9 in the sidebar.
  ...'?,qN[]123456789',
  // Moving, as alternatives to the arrow keys: j/k up and down, h/l left and right; with shift
  // (like shift+arrows), moving a Story or a list entry.
  ...'jkhlJKHL',
  // Lists and forms: `/` filters, space toggles; confirmation dialogs: y/n.
  ...'/ yn',
  // Screen actions: add, edit, delete, move Stage, top/bottom, filters (clear, all Boards), fix,
  // open (view Board, Stories, Stages, fields), reload. `a`, `e` and `s` are also `ctrl` bindings
  // of text inputs and forms.
  ...'nedmTBcAfvosra',
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

/**
 * `↑/↓` move, with `j`/`k` as alternatives. Pass `vim: false` where `j`/`k` are typed text.
 * `shift+↑/↓` is left to screens, where it moves the selected entry (like `K`/`J`).
 */
export function moveDelta(input: string, key: Key, vim = true): -1 | 0 | 1 {
  if (key.shift && (key.upArrow || key.downArrow)) return 0;
  if (key.upArrow || (vim && input === 'k')) return -1;
  if (key.downArrow || (vim && input === 'j')) return 1;
  return 0;
}
