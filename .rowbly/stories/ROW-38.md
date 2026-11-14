---
title: Add syntax highlighting to agent output.
stage: IN_REVIEW
position: 1
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-38
pull_request: https://github.com/sgolovine/rowbly/pull/229
---

## Goal

The conversation of a Thread (the Thread pane in the Story sidebar, and the Supervisor conversation in Factory) shows tool calls and tool results as one colour of plain text. The arguments of a tool call are a raw JSON line, for example `{"command":"pnpm lint 2>&1 | tail -30","timeout":300}` (see the attachment of this Story). It is hard to find the keys and the values in this text.

The user gets JSON in the agent output with syntax highlighting: keys, strings, numbers and literals, and punctuation each show in a different theme ink. Then the user can read tool calls and JSON tool results more quickly.

## Scope

In scope:

- The arguments of each `Tool call` row in the conversation (the text after `[tool <name>]`, which `session-display.ts` writes with `JSON.stringify`).
- The body of a `Tool result` entry when all of its text (trimmed) is JSON: it starts with `{` or `[`.
- A lexical JSON tokenizer that also accepts JSON that is cut (not complete), because `session-display.ts` bounds the text and the conversation caps the rows.

Not in scope:

- Highlighting of fenced code blocks in agent Markdown prose. They keep the present `ink-muted` tint.
- Highlighting of shell output, diffs or file contents in tool results (the language is not known).
- Pretty-printing (indenting) JSON, or a different layout of tool calls (for example, the `bash` command without JSON).
- A new colour token or a syntax-highlight library (for example `cli-highlight` or `highlight.js`).
- Changes to the row caps (`TOOL_CALL_ROWS`, `TOOL_RESULT_ROWS`, `ENTRY_ROWS`).

## Acceptance criteria

- [ ] A new pure function (for example `jsonTokens(text)` in `src/services/conversation/json-tokens.ts`) splits text into tokens of the kinds `key`, `string`, `number`, `literal` (`true`, `false`, `null`), `punctuation` (`{ } [ ] : ,`) and `plain` (whitespace and any other text). The concatenation of the token texts is always equal to the input.
- [ ] Its Vitest test (`json-tokens.test.ts`) examines: an object key is `key` and a string value is `string`; escaped quotes (`"a\"b"`) stay in one string token; numbers with sign, fraction and exponent; the three literals; nested arrays and objects; a cut input (for example `{"command":"pnpm te`) gives tokens and does not throw; non-JSON text gives tokens whose concatenation equals the input.
- [ ] In the TUI, the arguments of a `Tool call` row show keys in `accent`, strings in `ink`, numbers and literals in `ink-muted`, and punctuation in `ink-faint`. A person examines this in a real terminal (the `rowbly-screenshots` skill).
- [ ] In the TUI, a `Tool result` whose trimmed text starts with `{` or `[` shows with the same colours. Other tool results, `Shell` entries and `error` tool results look as they do now. A person examines this in a real terminal.
- [ ] A highlighted value that wraps to the next row keeps its colour on the next row (the tokens are coloured before or across the row wrap, not row by row from plain text).
- [ ] The row counts do not change: a tool call still shows at most 3 rows and a tool result at most 12 rows, with the `… n more lines` row.
- [ ] With `NO_COLOR` set, or when output is not a TTY, the conversation text is the same plain text as before.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Row building: `src/tui/components/conversation-lines.ts`. `specialRows` makes the `Tool call` rows (`plainRows(tool[2], width)` capped at `TOOL_CALL_ROWS`). `toolResultParts` makes the tool result body (`plainRows`, capped at `TOOL_RESULT_ROWS`).
- Drawing: `src/tui/components/conversation-entry/conversation-entry.tsx` draws each `ConversationLine` as one `<Text color={INK[tone]} wrap="truncate-end">`. Two possible methods:
  1. Add optional coloured segments to `ConversationLine` (for example `spans: { text, color }[]`) and draw one nested `<Text>` for each segment. This keeps the text free of ANSI codes.
  2. Put ANSI colour into the row text with `chalk.hex(theme.x)`, as `markdown.ts` already does for Markdown body rows. Then wrap with `wrap-ansi` (already a dependency, loaded lazily in `markdown.ts`) or wrap the tokens yourself.
  Method 1 is preferred. The developer selects the method and records the reason in the PR.
- The `capped()` helper and `boundedBody()` map rows to plain text. Keep the segments when a row passes through them, or apply the colour after the cap.
- The tokenizer is a pure function with no `ink`, `react` or `chalk` import. Put it in `src/services/conversation/` so that it has a test next to it (tests are not allowed in `src/tui/`). Obey the `rowbly-code-style` skill.
- Colours come only from `theme` in `src/tui/theme.ts` (`accent`, `ink`, `inkMuted`, `inkFaint`). Do not use `danger` or the Stage colours for tokens. Read the `rowbly-tui-design` skill.
- The line cache (`conversation-view/line-cache.ts`) keeps rows by entry, width and renderer. No cache change is necessary if the rows hold the colours.
- `safeText` removes escape sequences from the entry text before the rows are built. Add colour only after `safeText`.
- The TUI must not load Pi. Do not import from `src/services/pi-runtime/`.
- Update `docs/architecture/tui.md` (the Thread or conversation part) with one sentence about the JSON highlighting, in STE.

## Assumptions

- "Agent output" means the conversation view of a Thread, as the attachment shows. Reason: the screenshot shows the Thread pane with tool calls and tool results.
- Only JSON gets highlighting in this Story. Reason: the raw JSON of tool calls is the hardest text to read in the screenshot, and JSON is the only output with a known format. This is the smallest scope that agrees with the intent.
- Fenced code blocks in Markdown prose are not in scope. Reason: they already have a distinct `ink-muted` tint, and multi-language highlighting needs a library or many grammars. A person can create a new Story for it.
- Only the existing theme tokens are used, with no new hue. Reason: the `rowbly-tui-design` skill says to ask the user before a new hue is added, and no person is available. `danger` and Stage colours have other meanings.
- A tokenizer, not `JSON.parse`, finds the tokens. Reason: the text can be cut by the text bound or the row cap, and it must still show colours.
