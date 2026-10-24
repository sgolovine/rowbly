import type { PluginReconciler, RequiredStory } from '../../plugin-api';
import { LinksBag } from './model';

export const reconcile: PluginReconciler = ({ base, left, right, remaps, helpers, stories }) => {
  const bags: Record<string, unknown> = {},
    requiredStories: RequiredStory[] = [];
  for (const scope of new Set([...Object.keys(base.bags), ...Object.keys(left.bags), ...Object.keys(right.bags)])) {
    if (!scope.includes('/stories/')) continue;
    const raw = [base.bags[scope], left.bags[scope], right.bags[scope]];
    const parsed = raw.map((value) =>
      value === undefined ? { success: true as const, data: { blocks: [] as string[] } } : LinksBag.safeParse(value),
    );
    if (parsed.some((p, n) => !p.success || (raw[n] !== undefined && !helpers.same(p.data, raw[n])))) continue;
    const [old, a, b] = parsed.map((p) => (p.success ? p.data.blocks : []));
    const l = (a ?? []).map((key) => remaps[0].stories[key] ?? key),
      r = (b ?? []).map((key) => remaps[1].stories[key] ?? key);
    const members = helpers.members(old ?? [], l, r) as string[];
    bags[scope] = members.length ? { blocks: members } : undefined;
    for (const [side, originals] of [a, b].entries())
      for (const key of originals ?? []) {
        const map = remaps[side];
        if (!map) continue;
        const mapped = map.stories[key] ?? key;
        if (members.includes(mapped) && !stories.includes(mapped)) requiredStories.push({ source: map.source, key });
      }
  }
  return { bags, files: {}, requiredStories };
};
