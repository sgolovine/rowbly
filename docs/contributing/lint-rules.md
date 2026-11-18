# Lint rules

Rowbly turns each lint problem that a user reports into a rule, so that `pnpm lint` stops the problem
in the future. This page gives the procedure.

Read this when a user tells you about a lint problem, or when you add a Biome rule or a GritQL plugin.

## Procedure

When the user tells you about a lint problem that Biome can find, do these steps:

1. Repair the problem.
2. Add a Biome rule to `biome.jsonc` that finds the same problem.
3. Run `pnpm lint`, and repair all other code that the new rule finds.

If Biome has no rule for the problem, write a GritQL plugin in `biome-plugins/`, if the problem has a
pattern in the syntax. If a plugin cannot find the problem, repair it and tell the user.

## Where the rule goes

- A rule of the strict code style goes into the strict override of `biome.jsonc`.
- A rule that also applies to tests and config files goes into the global `linter` settings.

The [`rowbly-code-style` skill](../../.agents/skills/rowbly-code-style/SKILL.md#add-a-rule) gives the
full steps to add a rule, with the test of the rule and the update of its rule table.

## File names

All files and folders use dash-case names. `useFilenamingConvention` of Biome and
`scripts/check-names.mjs` examine the names.

There is one exception for the TanStack Router file-based routes in `packages/website/src/routes/`. The router
gives a meaning to the characters `$`, `_`, `-`, `(`, `)`, `{`, `}`, `[`, `]` and `.` in these names. In
this folder:

- `biome.jsonc` sets `useFilenamingConvention` to off. The `match` option of the rule cannot examine a
  name with many dot-separated route parts.
- `scripts/check-names.mjs` examines each name with `isGoodRouteSegment`. Each word in the name must
  be dash-case. For example, `$story-key.tsx` is correct, and `$storyKey.tsx` is an error.

Do not use these forms outside `packages/website/src/routes/`. The
[name check](../architecture/tooling.md#name-check) gives the list of forms.

## Related

- [../architecture/tooling.md](../architecture/tooling.md#biome): the Biome setup.
