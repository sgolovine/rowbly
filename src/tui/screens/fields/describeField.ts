import type { CustomFieldDef } from '../../../schemas';

/** A Custom Field's type and its settings, e.g. `select: s, m, l` or `number (≥ 0)`. */
export function describeField(f: CustomFieldDef): string {
  if (f.type === 'select' || f.type === 'multiselect') return `${f.type}: ${f.options.join(', ')}`;
  if (f.type === 'number') {
    const limits = [
      f.integer ? 'integer' : '',
      f.min !== undefined ? `≥ ${f.min}` : '',
      f.max !== undefined ? `≤ ${f.max}` : '',
    ];
    const text = limits.filter(Boolean).join(', ');
    return text ? `number (${text})` : 'number';
  }
  return f.type;
}
