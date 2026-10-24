import type { MergeFiles, PluginReconciler } from '../../plugin-api';
import { SpecsBag } from './specs';

export const reconcile: PluginReconciler = ({
  base: rawBase,
  left: rawLeft,
  right: rawRight,
  helpers,
  remaps,
  replay,
}) => {
  const origins: Record<string, Record<string, string>>[] = [];
  const projected = [rawBase, rawLeft, rawRight].map((raw, side) => {
    const snapshot = structuredClone(raw),
      origin: Record<string, Record<string, string>> = {};
    const map = Object.fromEntries(
      Object.entries([replay?.base, replay?.left, replay?.right][side] ?? {}).map(([scope, ids]) => [
        scope,
        Object.assign(Object.create(null), ids) as Record<string, string>,
      ]),
    );
    const paths = Object.keys(raw.files).filter((path) => /\/plugins\/specs\/[^/]+\.md$/.test(path));
    if (replay)
      for (const path of paths) {
        const file = raw.files[path];
        if (file) helpers.read(file);
      }
    const parts = (path: string) => {
      const at = path.lastIndexOf('/plugins/specs/');
      return { scope: path.slice(0, at), slug: path.slice(at + 15, -3) };
    };
    const used = new Set([
      ...paths,
      ...Object.entries(map).flatMap(([scope, ids]) =>
        Object.values(ids).map((id) => `${scope}/plugins/specs/${id}.md`),
      ),
    ]);
    const occupied = new Set<string>();
    for (const path of [...paths].sort((a, b) => {
      const x = parts(a),
        y = parts(b);
      return (
        Number(Boolean(map[y.scope]?.[y.slug])) - Number(Boolean(map[x.scope]?.[x.slug])) ||
        (a < b ? -1 : a > b ? 1 : 0)
      );
    })) {
      const { scope, slug } = parts(path);
      let to = map[scope]?.[slug] ?? slug;
      if (occupied.has(`${scope}/${to}`)) {
        if (map[scope]?.[slug]) throw new Error('Ambiguous Specs replay identity correspondence');
        let n = 2;
        while (used.has(`${scope}/plugins/specs/${slug}-${n}.md`)) n++;
        to = `${slug}-${n}`;
      }
      occupied.add(`${scope}/${to}`);
      used.add(`${scope}/plugins/specs/${to}.md`);
      const scoped: Record<string, string> = origin[scope] ?? Object.create(null);
      scoped[slug] = to;
      origin[scope] = scoped;
    }
    for (const path of paths) delete snapshot.files[path];
    for (const path of paths) {
      const { scope, slug } = parts(path),
        to = origin[scope]?.[slug] ?? slug,
        file = raw.files[path];
      if (file) snapshot.files[`${scope}/plugins/specs/${to}.md`] = file;
    }
    for (const [scope, bag] of Object.entries(raw.bags)) {
      const parsed = SpecsBag.safeParse(bag);
      if (!parsed.success || !helpers.same(parsed.data, bag)) continue;
      const board = scope.split('/').slice(0, 2).join('/');
      snapshot.bags[scope] = { specs: parsed.data.specs.map((slug) => origin[board]?.[slug] ?? slug) };
    }
    origins.push(origin);
    return snapshot;
  });
  const [base, left, right] = projected;
  if (!base || !left || !right) throw new Error('Missing Spec replay source');
  const identities: NonNullable<ReturnType<PluginReconciler>['identities']>[number][] = [];

  const a = structuredClone(left),
    b = structuredClone(right),
    bags: Record<string, unknown> = {},
    files: MergeFiles = {};
  const used = new Set([...Object.keys(base.files), ...Object.keys(a.files), ...Object.keys(b.files)]);
  const renamed: Record<string, string> = {};
  for (const path of Object.keys(a.files).sort()) {
    if (
      !/\/plugins\/specs\/[^/]+\.md$/.test(path) ||
      base.files[path] ||
      !b.files[path] ||
      helpers.same(a.files[path], b.files[path])
    )
      continue;
    let n = 2;
    while (used.has(path.replace(/\.md$/, `-${n}.md`))) n++;
    const target = path.replace(/\.md$/, `-${n}.md`);
    const file = b.files[path];
    if (!file) continue;
    b.files[target] = file;
    delete b.files[path];
    used.add(target);
    renamed[path] = target;
    helpers.retain(path, 'distinct concurrent Specs retained separately', undefined, a.files[path], file, [
      path,
      target,
    ]);
  }
  for (const path of used) {
    if (!/\/plugins\/specs\/[^/]+\.md$/.test(path)) continue;
    const old = base.files[path],
      l = a.files[path],
      r = b.files[path];
    if (!l && !r) continue;
    if (!l || !r) {
      const value = helpers.value(old, l, r, path);
      if (value !== undefined) files[path] = value as MergeFiles[string];
    } else
      files[path] = helpers.file(
        helpers.text(old ? helpers.read(old) : '', helpers.read(l), helpers.read(r), path),
        replay ? (helpers.value(old?.mode, l.mode, r.mode, `${path}/mode`) as MergeFiles[string]['mode']) : undefined,
      );
  }
  for (const scope of new Set([...Object.keys(base.bags), ...Object.keys(a.bags), ...Object.keys(b.bags)])) {
    if (!scope.includes('/stories/')) continue;
    const raw = [base.bags[scope], a.bags[scope], b.bags[scope]];
    const parsed = raw.map((v) =>
      v === undefined ? { success: true as const, data: { specs: [] as string[] } } : SpecsBag.safeParse(v),
    );
    if (parsed.some((p, n) => !p.success || (raw[n] !== undefined && !helpers.same(p.data, raw[n])))) continue;
    const [old, l, r] = parsed.map((p) => (p.success ? p.data.specs : []));
    const board = scope.split('/').slice(0, 2).join('/');
    const remapped = (r ?? []).map(
      (slug) => renamed[`${board}/plugins/specs/${slug}.md`]?.split('/').pop()?.slice(0, -3) ?? slug,
    );
    const members = helpers.members(old ?? [], l ?? [], remapped) as string[];
    bags[scope] = members.length ? { specs: members } : undefined;
    for (const slug of members) {
      const path = `${board}/plugins/specs/${slug}.md`;
      if (files[path]) continue;
      const source = a.files[path] ?? b.files[path] ?? base.files[path];
      if (!source) throw new Error(`Missing retained Board Spec ${slug}`);
      files[path] = source;
      helpers.retain(path, 'restored referenced Board Spec', base.files[path], a.files[path], b.files[path], source);
    }
  }
  for (const side of [1, 2])
    for (const [scope, map] of Object.entries(origins[side] ?? {}))
      for (const [from, projectedId] of Object.entries(map)) {
        const path = `${scope}/plugins/specs/${projectedId}.md`;
        const to = side === 2 ? (renamed[path]?.split('/').pop()?.slice(0, -3) ?? projectedId) : projectedId;
        if (from !== to) identities.push({ source: remaps[side - 1]?.source ?? '', scope, from, to });
      }
  const removedFiles = replay
    ? [
        ...new Set(
          origins.flatMap((scopes) =>
            Object.entries(scopes).flatMap(([scope, map]) =>
              Object.entries(map)
                .filter(([from, to]) => from !== to)
                .map(([from]) => `${scope}/plugins/specs/${from}.md`),
            ),
          ),
        ),
      ]
        .filter((path) => !Object.hasOwn(files, path))
        .sort()
    : [];
  return { bags, files, identities, removedFiles };
};
