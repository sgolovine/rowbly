import type { MergeFiles, PluginReconciler } from '../../plugin-api';
import { AssigneesBag, RosterSchema } from './model';

export const reconcile: PluginReconciler = ({ base, left, right, helpers }) => {
  const bags: Record<string, unknown> = {},
    files: MergeFiles = {},
    required = new Set<string>();
  for (const scope of new Set([...Object.keys(base.bags), ...Object.keys(left.bags), ...Object.keys(right.bags)])) {
    if (!scope.includes('/stories/')) continue;
    const raw = [base.bags[scope], left.bags[scope], right.bags[scope]];
    const parsed = raw.map((v) =>
      v === undefined ? { success: true as const, data: { assignees: [] as string[] } } : AssigneesBag.safeParse(v),
    );
    if (parsed.some((p, n) => !p.success || (raw[n] !== undefined && !helpers.same(p.data, raw[n])))) continue;
    const [old, a, b] = parsed.map((p) => (p.success ? p.data.assignees : []));
    const members = helpers.members(old ?? [], a ?? [], b ?? []) as string[];
    for (const handle of members) required.add(handle);
    bags[scope] = members.length ? { assignees: members } : undefined;
  }
  const path = 'plugins/assignees/roster.json';
  const raw = [base.files[path], left.files[path], right.files[path]].map((file) =>
    file ? JSON.parse(helpers.read(file)) : { version: 1, assignees: [] },
  );
  const parsed = raw.map((v) => RosterSchema.safeParse(v));
  if (parsed.some((p, n) => !p.success || !helpers.same(p.data, raw[n]))) return { bags: {}, files: {} };
  const [old, a, b] = parsed.map((p) =>
    Object.fromEntries((p.success ? p.data.assignees : []).map((v) => [v.handle, v])),
  );
  const merged = helpers.value(old, a, b, path) as Record<string, unknown>;
  for (const handle of required)
    if (!merged[handle]) {
      const person = a?.[handle] ?? b?.[handle] ?? old?.[handle];
      if (!person) throw new Error(`Missing retained Assignee ${handle}`);
      merged[handle] = person;
      helpers.retain(
        `${path}/${handle}`,
        'restored referenced Assignee',
        old?.[handle],
        a?.[handle],
        b?.[handle],
        person,
      );
    }
  if ([base, left, right].some((s) => s.files[path]))
    files[path] = helpers.file(
      `${JSON.stringify(
        {
          version: 1,
          assignees: Object.keys(merged)
            .sort()
            .map((key) => merged[key]),
        },
        null,
        2,
      )}\n`,
    );
  return { bags, files };
};
