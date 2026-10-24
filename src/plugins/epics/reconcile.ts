import type { MergeFiles, PluginMergeSnapshot, PluginReconciler } from '../../plugin-api';
import { EpicBag, EpicSchema } from './model';

export const reconcile: PluginReconciler = ({
  base: rawBase,
  left: rawLeft,
  right: rawRight,
  helpers,
  remaps,
  replay,
}) => {
  const epic = (snapshot: PluginMergeSnapshot, path: string) => {
    const file = snapshot.files[path];
    if (!file) return undefined;
    const value: unknown = JSON.parse(helpers.read(file));
    const parsed = EpicSchema.safeParse(value);
    return parsed.success && helpers.same(parsed.data, value) ? parsed.data : undefined;
  };
  const known = (path: string) => /^plugins\/epics\/[^/]+\.json$/.test(path);
  const origins: Record<string, string>[] = [];
  const projected = [rawBase, rawLeft, rawRight].map((raw, side) => {
    const snapshot = structuredClone(raw);
    const map: Record<string, string> = Object.assign(
      Object.create(null),
      [replay?.base, replay?.left, replay?.right][side]?.[''] ?? {},
    );
    const origin: Record<string, string> = Object.create(null);
    const paths = Object.keys(raw.files).filter(known);
    const used = new Set([...paths, ...Object.values(map).map((id) => `plugins/epics/${id}.json`)]);
    const occupied = new Set<string>();
    for (const path of [...paths].sort(
      (a, b) =>
        Number(Boolean(map[b.slice(14, -5)])) - Number(Boolean(map[a.slice(14, -5)])) || (a < b ? -1 : a > b ? 1 : 0),
    )) {
      const value = epic(raw, path);
      if (!value) continue;
      let id = map[value.id] ?? value.id;
      if (occupied.has(id)) {
        if (map[value.id]) throw new Error('Ambiguous Epics replay identity correspondence');
        let n = 2;
        while (used.has(`plugins/epics/${value.id.slice(0, 50)}-${n}.json`)) n++;
        id = `${value.id.slice(0, 50)}-${n}`;
      }
      used.add(`plugins/epics/${id}.json`);
      occupied.add(id);
      origin[value.id] = id;
    }
    // Remove all sources before installing destinations, including permutations.
    for (const id of Object.keys(origin)) delete snapshot.files[`plugins/epics/${id}.json`];
    for (const [from, to] of Object.entries(origin)) {
      const path = `plugins/epics/${from}.json`,
        value = epic(raw, path);
      if (!value) continue;
      const target = `plugins/epics/${to}.json`;
      if (snapshot.files[target]) throw new Error(`Opaque Epic blocks replay destination ${target}`);
      const file = raw.files[path];
      if (file)
        snapshot.files[target] =
          from === to ? file : helpers.file(`${JSON.stringify({ ...value, id: to }, null, 2)}\n`, file.mode);
    }
    for (const [scope, bag] of Object.entries(raw.bags)) {
      const parsed = EpicBag.safeParse(bag);
      if (parsed.success && helpers.same(parsed.data, bag))
        snapshot.bags[scope] = { epic: origin[parsed.data.epic] ?? parsed.data.epic };
    }
    origins.push(origin);
    return snapshot;
  });
  const [base, left, right] = projected;
  if (!base || !left || !right) throw new Error('Missing Epic replay source');
  const sides: [PluginMergeSnapshot, PluginMergeSnapshot] = [structuredClone(left), structuredClone(right)];
  const files: MergeFiles = {},
    bags: Record<string, unknown> = {};
  const identities: NonNullable<ReturnType<PluginReconciler>['identities']>[number][] = [];

  const used = new Set([...Object.keys(base.files), ...Object.keys(left.files), ...Object.keys(right.files)]);
  const replacements: Record<string, string> = Object.create(null);
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
    sides[1].files[target] = helpers.file(
      `${JSON.stringify({ ...b, id }, null, 2)}\n`,
      replay ? right.files[path]?.mode : undefined,
    );
    delete sides[1].files[path];
    helpers.retain(path, 'distinct concurrent Epics retained separately', undefined, a, b, [a.id, id]);
  }
  for (const path of used) {
    if (!known(path)) continue;
    const raw = [base.files[path], sides[0].files[path], sides[1].files[path]];
    const values = [epic(base, path), epic(sides[0], path), epic(sides[1], path)];
    if (raw.some((file, n) => file && !values[n])) continue;
    const value = helpers.value(values[0], values[1], values[2], path);
    if (value !== undefined && values[0] && values[1] && values[2])
      (value as { description: string }).description = helpers.text(
        values[0].description,
        values[1].description,
        values[2].description,
        `${path}/description`,
      );
    if (value !== undefined)
      files[path] = helpers.file(
        `${JSON.stringify(value, null, 2)}\n`,
        replay
          ? (helpers.value(raw[0]?.mode, raw[1]?.mode, raw[2]?.mode, `${path}/mode`) as MergeFiles[string]['mode'])
          : undefined,
      );
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
  for (const side of [1, 2])
    for (const [from, projectedId] of Object.entries(origins[side] ?? {})) {
      const to = side === 2 ? (replacements[projectedId] ?? projectedId) : projectedId;
      if (from !== to) identities.push({ source: remaps[side - 1]?.source ?? '', scope: '', from, to });
    }
  const removedFiles = replay
    ? [
        ...new Set(
          origins.flatMap((origin) =>
            Object.entries(origin)
              .filter(([from, to]) => from !== to)
              .map(([from]) => `plugins/epics/${from}.json`),
          ),
        ),
      ]
        .filter((path) => !Object.hasOwn(files, path))
        .sort()
    : [];
  return { bags, files, identities, removedFiles };
};
