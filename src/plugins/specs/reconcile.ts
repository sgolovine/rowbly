import type { MergeFiles, PluginReconciler } from '../../plugin-api';
import { SpecsBag } from './specs';

export const reconcile: PluginReconciler = ({ base, left, right, helpers }) => {
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
      files[path] = helpers.file(helpers.text(old ? helpers.read(old) : '', helpers.read(l), helpers.read(r), path));
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
  return { bags, files };
};
