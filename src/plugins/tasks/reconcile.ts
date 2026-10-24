import type { PluginReconciler, RequiredStage } from '../../plugin-api';
import { TasksBag } from './model';

export const reconcile: PluginReconciler = ({ base, left, right, helpers, remaps, stages }) => {
  const bags: Record<string, unknown> = {};
  const requiredStages: RequiredStage[] = [];
  for (const scope of new Set([...Object.keys(base.bags), ...Object.keys(left.bags), ...Object.keys(right.bags)])) {
    const raw = [base.bags[scope], left.bags[scope], right.bags[scope]];
    const parsed = raw.map((value) => TasksBag.safeParse(value ?? { nextNumber: 1, tasks: [] }));
    if (parsed.some((p, n) => !p.success || (raw[n] !== undefined && !helpers.same(p.data, raw[n])))) continue;
    const [old, a, b] = parsed.map((p) => (p.success ? p.data : { nextNumber: 1, tasks: [] }));
    if (!old || !a || !b) continue;
    const tasks = [];
    let next = Math.max(
      old.nextNumber,
      a.nextNumber,
      b.nextNumber,
      ...[...old.tasks, ...a.tasks, ...b.tasks].map((t) => t.number + 1),
    );
    for (const number of [...new Set([...old.tasks, ...a.tasks, ...b.tasks].map((t) => t.number))].sort(
      (x, y) => x - y,
    )) {
      const before = old.tasks.find((t) => t.number === number),
        l = a.tasks.find((t) => t.number === number),
        r = b.tasks.find((t) => t.number === number);
      if (!before && l && r && !helpers.same(l, r)) {
        const second = { ...r, number: next++ };
        tasks.push(l, second);
        helpers.retain(
          `${scope}/tasks/${number}`,
          'distinct concurrent Tasks retained with separate numbers',
          undefined,
          l,
          r,
          [l, second],
        );
      } else {
        const value = helpers.value(before, l, r, `${scope}/tasks/${number}`);
        if (value !== undefined) {
          if (before && l && r)
            (value as typeof before).description = helpers.text(
              before.description,
              l.description,
              r.description,
              `${scope}/tasks/${number}/description`,
            );
          tasks.push(value);
        }
      }
    }
    bags[scope] = { nextNumber: next, tasks };
    const board = scope.split('/')[1];
    if (board)
      for (const [side, original] of [a.tasks, b.tasks].entries())
        for (const task of original) {
          const map = remaps[side];
          if (!map || stages[board]?.includes(task.stage)) continue;
          if (tasks.some((t) => (t as typeof task).stage === task.stage))
            requiredStages.push({
              source: map.source,
              board: Object.entries(map.boards).find(([, value]) => value === board)?.[0] ?? board,
              key: task.stage,
            });
        }
  }
  return { bags, files: {}, requiredStages };
};
