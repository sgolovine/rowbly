# ADR-0001: JSON files in a folder tree are the only storage

**Status:** Accepted. Amended by [ADR-0015](0015-specs-are-markdown-files.md): Specs are Markdown files. Amended by [ADR-0036](0036-binary-plugin-files-use-the-commit-journal.md): binary Plugin files use the same journal.

Rowbly stores all data as JSON files in a folder tree under the Data Root, read with `fs/promises` and validated with zod. There is no SQLite database. An early draft of the architecture mentioned an SQLite database; that was a mistake. We chose files because small pods share Rowbly data by committing it to git. Files are easy to diff, review and edit by hand, and storing one entity per file keeps merge conflicts small. We can add a cache later if listing gets slow, but the cache must always be rebuildable from the files.
