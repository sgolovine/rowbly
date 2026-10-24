import type { PluginReconciler } from '../../plugin-api';
import { CommentsBag } from './model';

export const reconcile: PluginReconciler = ({ base, left, right, helpers }) => {
  const bags: Record<string, unknown> = {};
  for (const scope of new Set([...Object.keys(base.bags), ...Object.keys(left.bags), ...Object.keys(right.bags)])) {
    const raw = [base.bags[scope], left.bags[scope], right.bags[scope]];
    const parsed = raw.map((value) => CommentsBag.safeParse(value ?? { comments: [] }));
    if (parsed.some((p, n) => !p.success || (raw[n] !== undefined && !helpers.same(p.data, raw[n])))) continue;
    const [old, a, b] = parsed.map((p) => (p.success ? p.data.comments : []));
    if (!old || !a || !b) continue;
    const comments = [],
      used = new Set([...old, ...a, ...b].map((c) => c.id));
    for (const id of [...used].sort()) {
      const before = old.find((c) => c.id === id),
        l = a.find((c) => c.id === id),
        r = b.find((c) => c.id === id);
      if (!before && l && r && !helpers.same(l, r)) {
        let n = 2;
        while (used.has(`${id}-${n}`)) n++;
        const second = { ...r, id: `${id}-${n}` };
        used.add(second.id);
        comments.push(l, second);
        helpers.retain(
          `${scope}/comments/${id}`,
          'distinct concurrent Comments retained with separate identities',
          undefined,
          l,
          r,
          [l, second],
        );
      } else {
        const value = helpers.value(before, l, r, `${scope}/comments/${id}`);
        if (value !== undefined) {
          if (before && l && r)
            (value as typeof before).body = helpers.text(before.body, l.body, r.body, `${scope}/comments/${id}/body`);
          comments.push(value);
        }
      }
    }
    bags[scope] = { comments };
  }
  return { bags, files: {} };
};
