# ADR Format

ADRs are **Story Specs** of the interviewed Story. Never create files in `docs/adr/`,
`docs/agents/adr/`, the repository root, or this skill folder.

## Template

```md
# {Short title of the decision}

{1-3 sentences: what's the context, what did we decide, and why.}
```

That's it. An ADR can be a single paragraph. The value is in recording *that* a decision was made and *why* — not in filling out sections.

## Optional sections

Only include these when they add genuine value. Most ADRs won't need them.

- **Status** frontmatter (`proposed | accepted | deprecated | superseded by ADR-NNNN`) — useful when decisions are revisited
- **Considered Options** — only when the rejected alternatives are worth remembering
- **Consequences** — only when non-obvious downstream effects need to be called out

## Numbering

Read `rowbly specs list --story KEY --json --no-prompt` (after reading the Rowbly reference).
Among this Story's slugs matching `adr-NNNN-…`, increment the highest number; start at `0001` when
there are none. Numbering is per Story, independent of repository ADRs and other Stories. Do not
reuse a number or overwrite a different decision. Use slug `adr-NNNN-kebab-title` and title
`ADR NNNN: title`. Preserve accepted records; ask before superseding a decision, and record the
relationship in both Story Specs through the CLI.

After the person agrees to record a qualifying decision, send its Markdown on stdin:

```sh
rowbly specs create adr-0001-storage-boundary --story KEY --title "ADR 0001: Storage boundary" --file - --json --no-prompt
```

For an agreed edit, use `specs edit <slug> --story KEY --file -`. Pin the intended `--data-root` and
use `--json --no-prompt` on every call. The Spec heading must match its ADR title.

## When to offer an ADR

All three of these must be true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful
2. **Surprising without context** — a future reader will look at the code and wonder "why on earth did they do it this way?"
3. **The result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons

If a decision is easy to reverse, skip it — you'll just reverse it. If it's not surprising, nobody will wonder why. If there was no real alternative, there's nothing to record beyond "we did the obvious thing."

### What qualifies

- **Architectural shape.** "We're using a monorepo." "The write model is event-sourced, the read model is projected into Postgres."
- **Integration patterns between contexts.** "Ordering and Billing communicate via domain events, not synchronous HTTP."
- **Technology choices that carry lock-in.** Database, message bus, auth provider, deployment target. Not every library — just the ones that would take a quarter to swap out.
- **Boundary and scope decisions.** "Customer data is owned by the Customer context; other contexts reference it by ID only." The explicit no-s are as valuable as the yes-s.
- **Deliberate deviations from the obvious path.** "We're using manual SQL instead of an ORM because X." Anything where a reasonable reader would assume the opposite. These stop the next engineer from "fixing" something that was deliberate.
- **Constraints not visible in the code.** "We can't use AWS because of compliance requirements." "Response times must be under 200ms because of the partner API contract."
- **Rejected alternatives when the rejection is non-obvious.** If you considered GraphQL and picked REST for subtle reasons, record it — otherwise someone will suggest GraphQL again in six months.
