# ADR-0002: Data Root is discovered like `.git`, with a global fallback

**Status:** Accepted; amended by [ADR-0033](0033-known-data-roots-select-the-data-root.md), which adds the Home Config's default Data Root before discovery and replaces `--root` and `ROWBLY_ROOT` with `--data-root`.

Rowbly looks for a `.rowbly/` directory starting in the current directory and walking up through each parent. If it finds none, it uses `~/.rowbly`. This lets a team keep its tracker inside a code repository and share it through git, while a single developer can still keep one tracker for the whole machine. A `--root` flag or the `ROWBLY_ROOT` environment variable overrides discovery (now `--data-root` only, ADR-0033).
