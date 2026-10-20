# Performance checks (PERF-07)

The benchmark, `bench.ts`, is opt-in: `pnpm bench:plugins`. It is never part of `pnpm test` or CI.
Run it by hand when a change could make reads grow with a cross-product (Epics × Stories, links,
candidate slugs, pending lookups).

## Running the benchmark

```sh
pnpm bench:plugins                          # 100, 1,000 and 5,000 Stories, 3 samples each
pnpm bench:plugins --sizes 100,1000 --samples 5
pnpm bench:plugins --no-cli                 # in-process workloads only, without building the CLI
```

It builds the CLI into `.test-dist/bench-*`, generates each fixture under the system temp folder
(`fixture.ts`, after the review's corrected `gen.mjs`), and removes both at the end. Before timing a
size, doctor must report no error or warning on the fixture with the Built-in Plugins on and off.

Each line prints every sample, then min, median and max of the valid ones. The header records the
date, commit, Node, OS, CPU, memory, load average, fixture size and cache state. A sample whose CLI
exits non-zero, or whose work throws, is printed as `INVALID`, left out of the summary, and makes
the run exit 1. Write workloads run on a fresh copy of the fixture per sample; the pipeline samples
edit one Story in succession, as their note says.

The numbers describe one machine at one moment. Compare runs on the same machine; do not turn them
into CI thresholds.
