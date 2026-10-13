// The Story filter form shared by the Stories list and the board view: its fields, how the values
// become a `StoryFilter`, and the one-line summary.
import { type Priority, PrioritySchema, type StageCategory, StageCategorySchema } from '../../../schemas';
import type { StoryFilter, StorySort } from '../../../services';
import type { FormField, FormValues } from '../../components';
import { NONE } from './shared';

/** The select choice meaning "do not filter on this". */
export const ANY = '(any)';
const SORTS: readonly StorySort[] = ['rank', 'priority', 'created', 'updated', 'due'];

/** What the filter form can offer. */
export interface FilterChoices {
  /** Not needed with `board: true`. */
  stages?: readonly string[];
  assignees: readonly string[];
  labels: readonly string[];
  epics: readonly string[];
}

/**
 * The filter form fields. The board view leaves out the Stage, Stage Category, open-only and sort
 * fields (`board: true`), since its Stages are its columns and its order is Rank.
 */
export function filterFields(choices: FilterChoices, { board = false } = {}): FormField[] {
  const stage: FormField = { name: 'stage', label: 'Stages', kind: 'multiselect', options: choices.stages ?? [] };
  const shared: FormField[] = [
    { name: 'assignee', label: 'Assignees', kind: 'multiselect', options: choices.assignees },
    { name: 'me', label: 'Assigned to me', kind: 'boolean' },
    { name: 'label', label: 'Labels', kind: 'multiselect', options: choices.labels },
    { name: 'priority', label: 'Priorities', kind: 'multiselect', options: PrioritySchema.options },
    { name: 'epic', label: 'Epic', kind: 'select', options: [ANY, NONE, ...choices.epics] },
    { name: 'search', label: 'Search', kind: 'text' },
  ];
  if (board) return shared;
  return [
    stage,
    ...shared,
    { name: 'category', label: 'Stage Category', kind: 'select', options: [ANY, ...StageCategorySchema.options] },
    { name: 'open', label: 'Open only', kind: 'boolean' },
    { name: 'sort', label: 'Sort', kind: 'select', options: SORTS },
  ];
}

/** The form's starting values: the current filters over "any" for every select. */
export function filterInitialValues(filters: FormValues): FormValues {
  return { epic: ANY, category: ANY, sort: 'rank', ...filters };
}

function chosen(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' && value !== ANY ? value : undefined;
}

/** The chosen options of a multiselect. */
function many(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

export function toFilter(filters: FormValues): StoryFilter {
  const stages = many(filters.stage);
  const assignees = [...many(filters.assignee), ...(filters.me === true ? ['me'] : [])];
  const labels = many(filters.label);
  const priorities = many(filters.priority) as Priority[];
  const epic = chosen(filters.epic);
  const search = chosen(filters.search);
  const category = chosen(filters.category) as StageCategory | undefined;
  const sort = chosen(filters.sort) as StorySort | undefined;
  return {
    ...(stages.length > 0 ? { stages } : {}),
    ...(assignees.length > 0 ? { assignees } : {}),
    ...(labels.length > 0 ? { labels } : {}),
    ...(priorities.length > 0 ? { priorities } : {}),
    ...(epic ? { epicId: epic === NONE ? null : epic } : {}),
    ...(search ? { search } : {}),
    ...(category ? { category } : {}),
    ...(filters.open === true ? { open: true } : {}),
    ...(sort && sort !== 'rank' ? { sort } : {}),
  };
}

export function describeFilters(filters: FormValues): string {
  const list = (value: unknown, prefix = '') =>
    many(value)
      .map((v) => `${prefix}${v}`)
      .join(' ');
  const parts = [
    many(filters.stage).length > 0 && `stage ${list(filters.stage)}`,
    list(filters.assignee, '@'),
    filters.me === true && 'mine',
    list(filters.label, '#'),
    list(filters.priority),
    chosen(filters.epic) && (filters.epic === NONE ? 'no Epic' : `Epic ${filters.epic}`),
    chosen(filters.search) && `"${filters.search}"`,
    chosen(filters.category) && `${filters.category} Stages`,
    filters.open === true && 'open',
    chosen(filters.sort) && filters.sort !== 'rank' && `sorted by ${filters.sort}`,
  ];
  return parts.filter(Boolean).join(' · ');
}
