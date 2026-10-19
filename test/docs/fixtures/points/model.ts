// The tutorial's Points Plugin (docs/plugins/writing-a-plugin.md). As a Built-in Plugin it would be
// src/plugins/points/; the regions are what the guide shows.
// #region model
import { type PluginReadContext, type Story, z } from '../../../../src/plugin-api';

/** The settings: `"points": { "enabled": true, "label": "Estimate", "max": 8 }`. A Board may change `max`. */
export const PointsSettings = z.strictObject({
  label: z.string().default('Points'),
  max: z.number().int().positive().default(13),
});
export type PointsSettings = z.output<typeof PointsSettings>;

/** The bag on a Story: `"plugins": { "points": { "points": 3 } }`. */
export const PointsBag = z.object({ points: z.number().int().min(0) });

/** The input of `stories.create` and `stories.update`: a number sets the points, `null` clears them. */
export const PointsInput = z.object({ points: z.number().int().min(0).nullable() });
export type PointsInput = z.output<typeof PointsInput>;

/** A Story's points, or `undefined` when it has none. Tolerant (`readBag`): for display only. */
export function storyPoints(plugin: PluginReadContext<PointsSettings>, story: Story): number | undefined {
  return plugin.readBag(story, PointsBag)?.points;
}
// #endregion
