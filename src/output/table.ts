import Table from 'cli-table3';
import { colors } from './colors';

/** A borderless table with a bold header, sized to its content. */
export function renderTable(head: string[], rows: string[][]): string {
  const table = new Table({
    head: head.map((title) => colors.bold(title)),
    chars: {
      top: '',
      'top-mid': '',
      'top-left': '',
      'top-right': '',
      bottom: '',
      'bottom-mid': '',
      'bottom-left': '',
      'bottom-right': '',
      left: '',
      'left-mid': '',
      mid: '',
      'mid-mid': '',
      right: '',
      'right-mid': '',
      middle: '  ',
    },
    style: { head: [], border: [], 'padding-left': 0, 'padding-right': 0 },
  });
  table.push(...rows);
  return table.toString();
}
