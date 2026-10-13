# Review reproduction archive

These are the original ad hoc evidence scripts from `/tmp/rowbly-review`, archived so the findings do not depend on temporary files. They are diagnostic fixtures, not the production regression suite. They create temporary Data Roots and do not use your real Rowbly data.

Run from the reviewed checkout:

```sh
node_modules/.bin/tsx docs/reviews/plugin-architecture/repros/r01-concurrent-create.ts
```

The original scripts contain absolute imports pointing to `/home/sgolovine/Projects/rowbly`; update those imports and the subprocess executable paths when running in another worktree. Some scripts intentionally use invalid data, mutable casts, filesystem permission changes, file-size limits, or never-settling handlers. Read the script before running it; use a bounded timeout for hang fixtures. Permission-failure reproductions assume an ordinary non-root user. The scripts print observations and may need manual interpretation; they do not assert correctness or constitute proof of cross-process locking behavior.

The supervisor independently reran `r01-concurrent-create.ts`, `r06-doctor-stale-key.ts`, and `r13-invalid-bag-dropped.ts`. See the resilience report for other evidence and limitations. Convert accepted findings into isolated permanent tests as part of implementation; do not adopt these fixtures verbatim as a public plugin tutorial.
