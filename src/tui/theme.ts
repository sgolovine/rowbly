/** Semantic terminal colours from the Rowbly design system. Ground stays unpainted. */
export const themes = {
  dark: {
    ground: '#111214',
    overlay: '#1b1c21',
    overlayRaised: '#23242b',
    keycap: '#2c2d35',
    field: '#26272e',
    fieldFocus: '#2f3140',
    selection: '#17324a',
    ink: '#e7e6e1',
    inkMuted: '#a3a39b',
    inkFaint: '#8e8f97',
    border: '#3a3b42',
    borderControl: '#64656d',
    accent: '#56b6e8',
    onAccent: '#111214',
    dropTarget: '#2a6f9e',
    stageBacklog: '#9a9aa2',
    stageBoard: '#e8b04b',
    stageDone: '#5cc58a',
    danger: '#f07a6f',
    epic: '#b9a0f0',
  },
  light: {
    ground: '#f7f6f2',
    overlay: '#ffffff',
    overlayRaised: '#f1f0eb',
    keycap: '#e4e3dc',
    field: '#ecebe5',
    fieldFocus: '#e2e6ef',
    selection: '#dbe9f5',
    ink: '#1c1d21',
    inkMuted: '#55565c',
    inkFaint: '#63646b',
    border: '#c9c8c0',
    borderControl: '#8a8981',
    accent: '#0b6aa3',
    onAccent: '#ffffff',
    dropTarget: '#9ccbea',
    stageBacklog: '#62636a',
    stageBoard: '#8a5a00',
    stageDone: '#176b3d',
    danger: '#b4312a',
    epic: '#6a4bbf',
  },
} as const;

/** COLORFGBG uses ANSI background indexes; pale backgrounds select the light palette. */
const background = Number(process.env.COLORFGBG?.split(';').at(-1) ?? 0);
export const theme = themes[[7, 15].includes(background) ? 'light' : 'dark'];
export const stageColors = { backlog: theme.stageBacklog, board: theme.stageBoard, done: theme.stageDone };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Human dates are local to the terminal, as `20 Oct 2026, 23:03`, with a fixed three-letter month
 * whatever the locale data says (`en-GB` writes `Sept`); storage and CLI JSON retain ISO timestamps.
 */
export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const day = `${pad(date.getDate())} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
  return `${day}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A compact elapsed-time label for a screen header. */
export function relativeDate(value: string, now = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}
