# Personal Git automation consumer task

Starting fixture: an installed Rowbly CLI, a Git repository containing a clean Data Root with Board `web`, one baseline commit, an unrelated staged `unrelated.txt`, and copied Rowbly skills available through a consumer skill catalog. No source tree or grader is in the consumer context.

Task: Have Rowbly automatically commit its Board edits every ten minutes as Rowbly Bot <bot@example.com>. Create a Story titled “Consumer Git check” on the existing web Board after configuring it. Preserve the unrelated staged file. Use command mode, do not run a daemon or wait ten minutes, and leave the final settings in interval mode.

Grade with `node test/skills/checkGitConsumer.mjs <fixture-directory>`. The same grader must fail if the consumer picks after-each-change mode instead. The CLI workflow in `test/plugins/gitCli.test.ts` exercises the executable recipe and its validation errors against a fresh build.

Discovery probes (assessed separately):

- Should load rowbly-plugins: “Have Rowbly commit my board edits every ten minutes with my bot email.”
- Should not load rowbly-plugins: “Configure git's signing key for this code repository.”

2026-10-19 observation: a fresh gpt-6.1-sol consumer with copied skills and the built 0.1.0 CLI completed the task; the external grader passed and rejected an incorrect frequency. The consumer reported reading rowbly-cli, rowbly-plugins and rowbly-stories. Exposure used a supplied local skill catalog rather than an installed Intent consumer setup; normal runtime discovery and the negative activation probe remain unverified. This single task run is not a reliability claim.
