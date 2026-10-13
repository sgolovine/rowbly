# JSON files in a folder tree are the only storage

Rowbly stores all data as JSON files in a folder tree under the Data Root, read with `fs/promises` and validated with zod. There is no SQLite database. The earlier mention of "the SQLite DB" in `ARCHITECTURE.md` was a mistake. We chose files because small pods share Rowbly data by committing it to git. Files are easy to diff, review and edit by hand, and storing one entity per file keeps merge conflicts small. We can add a cache later if listing gets slow, but the cache must always be rebuildable from the files.

_ADR-0015 makes one exception: Specs are markdown files._
