import type { PluginReconciler, RequiredStage } from '../../plugin-api';
import { TasksBag, TasksBagShape } from './model';

export const reconcile: PluginReconciler = ({ base, left, right, helpers, remaps, stages, replay }) => {
  const bags: Record<string, unknown> = {};
  const identities: NonNullable<ReturnType<PluginReconciler>['identities']>[number][] = [];
  const requiredStages: RequiredStage[] = [];
  for (const scope of new Set([...Object.keys(base.bags), ...Object.keys(left.bags), ...Object.keys(right.bags)])) {
    const raw = [base.bags[scope], left.bags[scope], right.bags[scope]];
    const parsed = raw.map((value) => TasksBagShape.safeParse(value ?? { nextNumber: 1, tasks: [] }));
    // Check each recognized source before an unsupported neighbour can select opaque fallback.
    for (const [n, p] of parsed.entries()) {
      if (!p.success || (raw[n] !== undefined && !helpers.same(p.data, raw[n]))) continue;
      const valid = TasksBag.safeParse(p.data);
      if (!valid.success) throw new Error(`Cannot reconcile Tasks at ${scope}: ${valid.error.issues[0]?.message}`);
    }
    if (parsed.some((p, n) => !p.success || (raw[n] !== undefined && !helpers.same(p.data, raw[n])))) continue;
    const origins: Record<string, string>[] = [];
    const reserved = new Set(parsed.flatMap((p) => (p.success ? p.data.tasks.map((task) => task.number) : [])));
    for (const map of [replay?.base, replay?.left, replay?.right])
      for (const value of Object.values(map?.[scope] ?? {})) reserved.add(Number(value));
    let allocation = Math.max(1, ...reserved) + 1;
    const [old, a, b] = parsed.map((p, side) => {
      const value = p.success ? p.data : { nextNumber: 1, tasks: [] };
      const map = [replay?.base, replay?.left, replay?.right][side]?.[scope];
      const origin: Record<string, string> = Object.create(null);
      const tasks = value.tasks.map((task) => ({ ...task, number: Number(map?.[String(task.number)] ?? task.number) }));
      const occupied = new Set<number>();
      // Earlier transported identities keep their destinations; new original numbers allocate around them.
      for (const index of value.tasks
        .map((_, n) => n)
        .sort(
          (x, y) =>
            Number(Boolean(map?.[String(value.tasks[y]?.number)])) -
            Number(Boolean(map?.[String(value.tasks[x]?.number)])),
        )) {
        const original = value.tasks[index],
          task = tasks[index];
        if (!original || !task) continue;
        if (occupied.has(task.number)) {
          if (map?.[String(original.number)]) throw new Error('Ambiguous Tasks replay identity correspondence');
          task.number = allocation++;
        }
        occupied.add(task.number);
        origin[String(original.number)] = String(task.number);
      }
      origins.push(origin);
      const result = { nextNumber: Math.max(value.nextNumber, ...tasks.map((task) => task.number + 1)), tasks };
      TasksBag.parse(result);
      return result;
    });
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
        const original = Object.keys(origins[2] ?? {}).find((key) => origins[2]?.[key] === String(number));
        if (original !== undefined && origins[2]) origins[2][original] = String(second.number);
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
    for (const side of [1, 2])
      for (const [from, to] of Object.entries(origins[side] ?? {}))
        if (from !== to) identities.push({ source: remaps[side - 1]?.source ?? '', scope, from, to });
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
  return { bags, files: {}, requiredStages, identities };
};
