import { SlugSchema, ValidationError, z } from '../../plugin-api';

export const AssigneeSchema = z.object({
  handle: SlugSchema,
  name: z.string().trim().min(1),
  email: z.email().optional(),
});
export type Assignee = z.infer<typeof AssigneeSchema>;

/** `plugins/assignees/roster.json` in the Data Root. */
export const RosterSchema = z.object({
  version: z.literal(1),
  assignees: z.array(AssigneeSchema).superRefine((assignees, ctx) => {
    const seen = new Set<string>();
    for (const [index, { handle }] of assignees.entries()) {
      if (seen.has(handle)) {
        ctx.addIssue({ code: 'custom', path: [index, 'handle'], message: `duplicate handle "${handle}"` });
      }
      seen.add(handle);
    }
  }),
});
export type Roster = z.infer<typeof RosterSchema>;

/** A Story's Assignees, as handles. A Story without Assignees has no bag. */
export const AssigneesBag = z.object({ assignees: z.array(SlugSchema).min(1) });

/**
 * Input of `stories.create` and `stories.update`: `assignees` replaces the list, `add` and `remove`
 * change it. Handles may be the literal `me`, which is Me.
 */
export const AssigneesInput = z
  .object({
    assignees: z.array(z.string()).optional(),
    add: z.array(z.string()).optional(),
    remove: z.array(z.string()).optional(),
  })
  .refine((input) => input.assignees === undefined || (input.add === undefined && input.remove === undefined), {
    message: 'replace the Assignees or add/remove them, not both',
  });
export type AssigneesInput = z.output<typeof AssigneesInput>;

/** A Story filter: Stories with any of these Assignees; `me` is Me. */
export const AssigneesFilter = z.array(z.string()).min(1);

export const AssigneePatch = z.object({
  name: z.string().trim().min(1).optional(),
  /** `null` removes the email. */
  email: z.email().nullable().optional(),
});

/** `value` parsed by `schema`; otherwise a `ValidationError` naming `what` and each field's problem. */
export function validate<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(`Invalid ${what}: ${formatIssues(parsed.error.issues)}`, {
      details: { issues: parsed.error.issues },
    });
  }
  return parsed.data;
}

/** `name: problem; …`, one entry per issue. */
export function formatIssues(issues: readonly z.core.$ZodIssue[]): string {
  return issues.map((issue) => `${issue.path.length ? issue.path.join('.') : 'value'}: ${issue.message}`).join('; ');
}
