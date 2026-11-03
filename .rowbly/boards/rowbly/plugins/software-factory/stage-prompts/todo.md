# TODO

A person planned this Story. Review its readiness and record concrete questions or missing
requirements. This advisory pass never authorizes implementation and keeps the Story in TODO.
A finished Stage Run prevents another automatic pass during this visit. A person can request
another pass after answering with `rowbly software-factory run clear <KEY>`; the supervisor never
clears a finished Run to repeat a review. Leaving TODO and returning also creates a new visit.

1. **Read the published inputs.** Work only in the assigned task worktree. Fetch `origin` and merge
   `origin/main` there (never rebase); stop and ask if this cannot be done safely. Read the Story,
   all Comments, Story Specs and linked Board Specs, Tasks, Epic (including whether it is closed),
   Story links and each blocker's Stage and Stage Category. Read available Attachments, Assignees,
   effective configuration, this Stage Prompt and `ROWBLY.md`. Check the claims against relevant
   repository code, docs, skills and accepted ADRs. Do not implement, create branches or PRs, edit
   tracked files or write the Board. Temporary research evidence outside the checkout is allowed.
2. **Collect the fingerprint** from the repository root with the published, self-contained helper:

   ```text
   node skills/rowbly-factory/scripts/readiness-fingerprint.mjs <KEY> .rowbly -- pnpm --silent dev
   ```

   It requires Node 22+, Git and the named Rowbly command; it uses no shell, jq or sha256sum.
   Method 2 covers the helper, repository content outside `.rowbly`, Plugin availability, effective
   configuration, Story fields and other Comments, Specs, Tasks, links and blocker status, Epic,
   Attachment bytes, Assignees, this Stage Prompt and the Data Root's own `ROWBLY.md`.
   It excludes rank, Story `updatedAt`, the Stage Run and generated Comments whose body starts
   `Readiness review `. Reserve that prefix for readiness output; answers use ordinary Comments.
   Unknown Plugins or Story bags, off Plugins with stored Story data, failed reads, unsafe files,
   invalid JSON or unexpected shapes yield only `gap=<input>: <reason>`, exit 1 and no `overall`.
   The helper checks the physical Story Spec inventory, safe linked Board Spec files and their
   byte hashes against CLI text, including stored Story Specs when Specs is off. With Story Linking
   on, it checks same-Board Story candidates and their own story.json records for omitted incoming
   links. Unsafe or unrecognized entries, missing records, omitted inputs and files or inventories
   changed during collection are gaps; a filtered CLI list alone cannot prove completeness.
   It compares command results with their original reads, then rechecks safe files/inventories and
   the original normalized Story last, even with Story Linking off. Repository, guide and Attachment
   bytes are also checked again. These are boundary comparisons, not a lock across collection.
   The 14-field method-2 contract is unchanged; a changed helper hash requires another review.
   The current GitHub catalog entry is an unknown input contract, even when disabled; it produces
   a Plugin gap until that contract is separately reviewed. Never hide it to obtain completeness.
   Never replace a gap with empty data, infer a Plugin is off from failure, or claim completeness
   when a review input cannot be read. Missing Node means the helper could not run: an input gap.
3. **Use the checked comparison.** A successful result includes `method=2`, all 14 input hashes,
   `overall`, and `comparison=equal|changed|unknown`. The helper checks only the newest readiness
   Comment, accepts exactly the complete known method-2 input set and verifies its overall digest.
   `comparison=equal` is the only basis to skip: add no Comment, report the earlier review's id/date
   and "no new review input", then finish with `FACTORY-DONE <KEY>`. Repository changes count as
   input even if the Story itself did not change. `changed` requires another review; name changed
   inputs and earlier questions answered, unresolved or new. `unknown` (including an old method,
   missing or malformed previous fingerprint) requires a full review. A gap never means equal.
4. **Judge readiness.** Ask only concrete questions about unclear or untestable acceptance criteria,
   scope choices, missing requirements, conflicting accepted ADRs, unresolved blockers, dependencies
   or stack order, documentation, skill and configuration updates, checks and screenshots. Explain
   what evidence is missing. If all inputs are readable and the requirements are settled, record
   "Ready for a person to decide"; this never approves implementation. An incomplete review is
   "Needs answers", never Ready. If the Story itself cannot be read, report the exact failure under
   `FACTORY-QUESTIONS <KEY>` and wait rather than inventing a review.
5. **Confirm the reviewed inputs**, by running the helper again after research. If the complete
   fingerprint changed during review, reconcile and review those changes before reporting. If
   either read is incomplete, retain the gaps and report an incomplete review; never skip. Review
   any additional input you discovered but cannot fingerprint, report that gap, and do not use an
   equal result to skip it.
6. **Report one Comment** and no other Board command. Its body is one physical line. Use a single
   quoted body without a literal apostrophe (reword it), because the supervisor parses each line
   without a shell. Join only the method/hash lines, from `method=2` through `overall`, with spaces
   in the exact delimited field below; do not include `comparison`. For a gap use
   `Reviewed input (method 2): INCOMPLETE; <gaps>` with no overall. State concrete questions or
   missing requirements, or say none were found. Do not post an unchanged duplicate.

   ```rowbly
   rowbly comments add <KEY> --body 'Readiness review <UTC date>. Verdict: Needs answers | Questions: (1) <question>; Missing: <requirements or evidence>; Changed: <inputs and resolved/open questions, or first/full review> | Reviewed input (method 2): <method/hash lines joined with spaces, or INCOMPLETE and gaps> | Advisory only; this does not authorize implementation. A person decides when to move the Story to In Progress.'
   ```

7. **Stay in TODO and finish.** Do not report a move or edit, change the description, Stage,
   Priority or Labels, enable a prompt, clear a Run or start implementation. Questions found by
   a completed review belong in its Comment; they do not keep the review Run running. End with
   `FACTORY-DONE <KEY>`. The supervisor applies the Comment and finishes the Run in TODO.