import type { MergeFiles, PluginMergeSnapshot, PluginReconciler } from '../../plugin-api';
import { EpicBag, EpicSchema } from './model';

export const reconcile: PluginReconciler = ({ base, left, right, helpers }) => {
  const sides = [structuredClone(left), structuredClone(right)];
  const files: MergeFiles = {},
    bags: Record<string, unknown> = {};
  const epic = (snapshot: PluginMergeSnapshot, path: string) => {
    const file = snapshot.files[path];
    if (!file) return undefined;
    const value: unknown = JSON.parse(helpers.read(file));
    const parsed = EpicSchema.safeParse(value);
    return parsed.success && helpers.same(parsed.data, value) ? parsed.data : undefined;
  };
  const known = (path: string) => /^plugins\/epics\/[^/]+\.json$/.test(path);
  const used = new Set([...Object.keys(base.files), ...Object.keys(left.files), ...Object.keys(right.files)]);
  const replacements: Record<string, string> = {};
  for (const path of Object.keys(left.files).filter(known).sort()) {
    const a = epic(left, path),
      b = epic(right, path);
    if (base.files[path] || !a || !b || helpers.same(a, b)) continue;
    let n = 2;
    while (used.has(`plugins/epics/${b.id}-${n}.json`)) n++;
    const id = `${b.id.slice(0, 50)}-${n}`,
      target = `plugins/epics/${id}.json`;
    used.add(target);
    replacements[b.id] = id;
    sides[1]!.files[target] = helpers.file(`${JSON.stringify({ ...b, id }, null, 2)}\n`);
    delete sides[1]!.files[path];
    helpers.retain(path, 'distinct concurrent Epics retained separately', undefined, a, b, [a.id, id]);
  }
  for (const path of used) {
    if (!known(path)) continue;
    const raw = [base.files[path], sides[0]!.files[path], sides[1]!.files[path]];
    const values = [epic(base, path), epic(sides[0]!, path), epic(sides[1]!, path)];
    if (raw.some((file, n) => file && !values[n])) continue;
    const value = helpers.value(values[0], values[1], values[2], path);
    if (value !== undefined) files[path] = helpers.file(`${JSON.stringify(value, null, 2)}\n`);
  }
  const required = new Set<string>();
  for (const scope of new Set([...Object.keys(base.bags), ...Object.keys(left.bags), ...Object.keys(right.bags)])) {
    if (!scope.includes('/stories/')) continue;
    const raw = [base.bags[scope], left.bags[scope], right.bags[scope]];
    const parsed = raw.map((v) => (v === undefined ? undefined : EpicBag.safeParse(v)));
    if (parsed.some((p, n) => raw[n] !== undefined && (!p?.success || !helpers.same(p.data, raw[n])))) continue;
    const values = parsed.map((p) => (p?.success ? p.data : undefined));
    const r = values[2];
    if (r && replacements[r.epic]) r.epic = replacements[r.epic] ?? r.epic;
    const value = helpers.value(values[0], values[1], values[2], `${scope}/epic`) as { epic: string } | undefined;
    bags[scope] = value;
    if (value) required.add(value.epic);
  }
  for (const id of required) {
    const path = `plugins/epics/${id}.json`;
    if (files[path]) continue;
    const source = [left, right, base].find((s) => epic(s, path));
    if (!source?.files[path]) throw new Error(`Missing retained Epic ${id}`);
    files[path] = source.files[path];
    helpers.retain(
      path,
      'restored referenced Epic',
      base.files[path],
      left.files[path],
      right.files[path],
      files[path],
    );
  }
  return { bags, files };
};
