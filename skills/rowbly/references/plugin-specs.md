# Specs Plugin

Every command below takes `--json --no-prompt`, and a delete also needs `--yes`.

A Spec is a Markdown document that describes work to be done; it has no approval or Stage of its own. A
**Story Spec** belongs to one Story; a Story can have any number, each named by a slug that is unique
within the Story. A **Board Spec** belongs to a Board, has a slug, and Stories on that Board link to it.
A Spec's title is its first `# ` heading. The Plugin is off until `rowbly plugins enable specs`.

## Commands

```sh
# Story Specs of WEB-42 (always name the Story with --story; the slug comes after the verb)
printf '%s\n' "## Scope" "" "Email and password only." \
  | rowbly specs create --story WEB-42 --title "Login page" --file - --json --no-prompt   # slug: spec
rowbly specs create design --story WEB-42 --title "Design" --text "One form." --json --no-prompt
rowbly specs list --story WEB-42 --json --no-prompt             # [{slug, title, text}, …] by slug
rowbly specs show --story WEB-42 --json --no-prompt             # the Story Spec spec: {slug, title, text}
rowbly specs show design --story WEB-42 --json --no-prompt
rowbly specs edit design --story WEB-42 --file ./design.md --json --no-prompt
rowbly specs delete design --story WEB-42 --yes --json --no-prompt

# A Board Spec, and links from Stories
rowbly specs create auth-flow --board web --title "Auth flow" --text "Tokens expire after 1 h." --json --no-prompt
rowbly stories edit WEB-42 --add-spec auth-flow --json --no-prompt   # --spec replaces, --remove-spec unlinks
rowbly stories create --board web --name "Logout" --spec auth-flow --json --no-prompt
rowbly stories list --board web --spec auth-flow --json --no-prompt
rowbly specs list --board web --json --no-prompt                # Board Specs only
rowbly specs edit auth-flow --board web --title "Auth" --file ./auth-flow.md --json --no-prompt
rowbly specs delete auth-flow --board web --yes --json --no-prompt   # unlinks it from every Story
```

## Rules

- Text comes from `--text`, `--file <path>` or `--file -` (stdin). Do not use `--edit`.
- `--story <KEY>` without a slug names the Story Spec `spec` (`spec.md`). Give a slug for any other one;
  `--story` cannot be combined with `--board`.
- A Story can link only to Board Specs of its own Board.
- Deleting a Board Spec unlinks it from every Story, with a warning.
- A Board that has Board Specs cannot be deleted without `--force`, even when it has no Stories.
- If changing links exits 6 because the Story's stored links are invalid, `--reset-specs` (alone or with
  `--spec`) replaces them; it cannot be combined with `--add-spec` or `--remove-spec`.

## Data

- A Board Spec is `boards/<board>/plugins/specs/<slug>.md`. A Story Spec is
  `boards/<board>/stories/<KEY>/plugins/specs/<slug>.md`.
- A Story's links are `"plugins": { "specs": { "specs": ["auth-flow"] } }`.

## Doctor

`SPECS_MISSING_SPEC` (warning): a Story links to Board Specs that do not exist; `--fix` unlinks them.

## Common mistakes

- **HIGH: naming a Story Spec by slug.** `specs show web-42` looks for a Board Spec with that slug,
  because Story Keys are case-insensitive and `web-42` is also a valid slug. Use `--story WEB-42`, with
  the Story Spec's slug after the verb when it is not `spec`: `specs show design --story WEB-42`.
- **HIGH: `--spec` on `stories edit` to add one link.** It replaces all links. Use `--add-spec`.
- **MEDIUM: a second Story Spec without a slug.** `specs create --story WEB-42` always means the Story
  Spec `spec`, so a second one exits 4 (already exists). Name it: `specs create design --story WEB-42`.
