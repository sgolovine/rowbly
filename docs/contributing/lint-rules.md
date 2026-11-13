# Lint rules

Rowbly turns each lint problem that a user reports into a rule, so that `pnpm lint` stops the problem
in the future. This page gives the procedure.

Read this when a user tells you about a lint problem, or when you add a Biome rule or a GritQL plugin.

## Procedure

When the user tells you about a lint problem that Biome can find, do these steps:

1. Repair the problem.
2. Add a Biome rule to `biome.json` that finds the same problem.
3. Run `pnpm lint`, and repair all other code that the new rule finds.

If Biome has no rule for the problem, write a GritQL plugin in `biome-plugins/`, if the problem has a
pattern in the syntax. If a plugin cannot find the problem, repair it and tell the user.

## Where the rule goes

- A rule of the strict code style goes into the strict override of `biome.json`.
- A rule that also applies to tests and config files goes into the global `linter` settings.

The [`rowbly-code-style` skill](../../.agents/skills/rowbly-code-style/SKILL.md#add-a-rule) gives the
full steps to add a rule, with the test of the rule and the update of its rule table.

## Related

- [../architecture/tooling.md](../architecture/tooling.md#biome): the Biome setup.
