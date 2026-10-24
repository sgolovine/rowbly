import type { PluginReconciler } from '../../plugin-api';
import { CommentsBag, CommentsBagShape } from './model';

export const reconcile: PluginReconciler = ({ base, left, right, helpers, remaps, replay }) => {
  const bags: Record<string, unknown> = {};
  const identities: NonNullable<ReturnType<PluginReconciler>['identities']>[number][] = [];
  for (const scope of new Set([...Object.keys(base.bags), ...Object.keys(left.bags), ...Object.keys(right.bags)])) {
    const raw = [base.bags[scope], left.bags[scope], right.bags[scope]];
    const parsed = raw.map((value) => CommentsBagShape.safeParse(value ?? { comments: [] }));
    // Check each recognized source before an unsupported neighbour can select opaque fallback.
    for (const [n, p] of parsed.entries()) {
      if (!p.success || (raw[n] !== undefined && !helpers.same(p.data, raw[n]))) continue;
      const valid = CommentsBag.safeParse(p.data);
      if (!valid.success) throw new Error(`Cannot reconcile Comments at ${scope}: ${valid.error.issues[0]?.message}`);
    }
    if (parsed.some((p, n) => !p.success || (raw[n] !== undefined && !helpers.same(p.data, raw[n])))) continue;
    const origins: Record<string, string>[] = [];
    const reserved = new Set(parsed.flatMap((p) => (p.success ? p.data.comments.map((comment) => comment.id) : [])));
    for (const map of [replay?.base, replay?.left, replay?.right])
      for (const id of Object.values(map?.[scope] ?? {})) reserved.add(id);
    const [old, a, b] = parsed.map((p, side) => {
      const map: Record<string, string> = Object.assign(
        Object.create(null),
        [replay?.base, replay?.left, replay?.right][side]?.[scope] ?? {},
      );
      const rawComments = p.success ? p.data.comments : [];
      const origin: Record<string, string> = Object.create(null);
      const comments = rawComments.map((comment) => ({ ...comment, id: map?.[comment.id] ?? comment.id }));
      const occupied = new Set<string>();
      for (const index of rawComments
        .map((_, n) => n)
        .sort(
          (x, y) => Number(Boolean(map?.[rawComments[y]?.id ?? ''])) - Number(Boolean(map?.[rawComments[x]?.id ?? ''])),
        )) {
        const original = rawComments[index],
          comment = comments[index];
        if (!original || !comment) continue;
        if (occupied.has(comment.id)) {
          if (map?.[original.id]) throw new Error('Ambiguous Comments replay identity correspondence');
          let n = 2;
          while (reserved.has(`${original.id}-${n}`)) n++;
          comment.id = `${original.id}-${n}`;
          reserved.add(comment.id);
        }
        occupied.add(comment.id);
        origin[original.id] = comment.id;
      }
      origins.push(origin);
      CommentsBag.parse({ comments });
      return comments;
    });
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
        const original = Object.keys(origins[2] ?? {}).find((key) => origins[2]?.[key] === id);
        if (original !== undefined && origins[2]) origins[2][original] = second.id;
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
    for (const side of [1, 2])
      for (const [from, to] of Object.entries(origins[side] ?? {}))
        if (from !== to) identities.push({ source: remaps[side - 1]?.source ?? '', scope, from, to });
  }
  return { bags, files: {}, identities };
};
