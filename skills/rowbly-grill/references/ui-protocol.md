# Grill UI Protocol

The Grill UI is a persistent local web form served by `scripts/grill-ui.mjs` (Node 20+, no dependencies). You send each round as JSON; the user answers in the browser and clicks **Submit**; the blocked `ask` command prints their answers. Never generate HTML for questions yourself.

Resolve `scripts/grill-ui.mjs` in this skill's directory to an absolute path once as `$GRILL_UI`, and run every command from the same dedicated temporary session directory outside the repository. The server is scoped to the current directory and survives between commands.

## Commands

| Command | Effect |
| --- | --- |
| `node "$GRILL_UI" start --title "<plan name>"` | Start the server if needed, reset the session, and open the browser. Run once at the beginning. |
| `node "$GRILL_UI" ask <<'EOF' … EOF` | Post a round (JSON on stdin or a file path) and block until the user submits. Prints the answers. |
| `node "$GRILL_UI" wait` | Keep waiting for the latest round. |
| `node "$GRILL_UI" end --summary "<markdown>"` | Show the completion screen. Run after the user confirms shared understanding. |
| `node "$GRILL_UI" status` / `url` / `stop` | Inspect, print the URL, or shut down. |

`ask` and `wait` exit `0` with answers, `2` when they time out still pending (default `--timeout 540` seconds), and `1` on errors. Use a resumable tool execution so you can keep the person informed while waiting; do not block a tool call for ten minutes. On exit `2`, or if the shell kills the command, run `wait` — the round stays open in the browser. Add `--json` for structured output.

`start` and `ask` open the browser only when no tab is connected, and always print the URL; tell the user the URL once at the start. Set `--no-open` or `GRILL_UI_NO_OPEN=1` to suppress opening. Posting a new round cancels any unanswered one.

If the server cannot start within available permissions, or the browser UI is unavailable, fall back
to the same frontier in chat as numbered questions. Include context, choices, a recommended answer
and rationale for **every** question, including free-text questions. Wait for the person's answers;
carry skipped questions forward. A chat fallback uses the same saves and final shared-understanding
check as the browser. Never answer the form on the person's behalf.

## Round JSON

```json
{
  "title": "Round 2 — Storage",
  "context": "Optional markdown shown above the questions.",
  "questions": [
    {
      "title": "Which database backs the ledger?",
      "body": "Markdown. Explain what hangs on this decision.",
      "options": [
        { "label": "SQLite", "description": "Single file, no ops" },
        { "label": "Postgres", "description": "Concurrent writers" }
      ],
      "recommended": "B",
      "recommendation": "Billing jobs write concurrently."
    },
    {
      "title": "Which modules ship first?",
      "multiple": true,
      "options": ["Auth", "Billing", "Search"],
      "recommended": ["A", "C"],
      "recommendation": "Validate authentication and discovery before adding billing."
    },
    { "title": "What do we call a paying customer?", "recommendation": "Account" }
  ]
}
```

- Options may be strings or `{label, description, id}`. Ids default to `A`, `B`, `C`…; `recommended` takes an id or label (an array when `multiple` is true).
- Question ids default to `Q1`, `Q2`…; keep the defaults unless you need stable ids.
- A question without `options` is a free-text answer; `recommendation` becomes a one-click fill.
- Every option question also gets a "Something else" free-text choice and a per-question note. Set `"allowOther": false` to remove the free-text choice.
- Supported markdown: paragraphs, `-`/`1.` lists, `**bold**`, `*italic*`, inline code, fenced code blocks.

## Answers

```text
Answers for round 2 (Round 2 — Storage):

Q1. Which database backs the ledger?
  Answer: B. Postgres (recommended)
  Note: keep SQLite for tests

Q2. Which modules ship first?
  Answer: A. Auth (recommended); C. Search (recommended)

Q3. What do we call a paying customer?
  Answer: Customer

General comment: …
```

`(skipped)` means the user left a question blank; carry it into the next round if it still matters. Treat notes and the general comment as answers too — they can reshape the design tree.

## Ending

Put the shared-understanding check to the user as the final round (for example "Is this a shared understanding?" with "Yes, wrap up" / "No, keep going"). When confirmed, run `end` with a short markdown summary of the decisions and documentation changes.

`end` leaves the server alive. After it, or on cancellation/error, run `node "$GRILL_UI" stop` from
the same session directory. Session files live under the system temporary directory; do not copy
them into the repository or Data Root.
