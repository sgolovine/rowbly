# ADR-0050: Merge Evidence records only real decisions and is kept as audit history

**Status:** Accepted (ROW-65); amends ADR-0034 §2

## 1. Context

ADR-0034 §2 retains the base, both alternatives, provenance, deletion intent and repairs of each
synchronization in committed, content-addressed Merge Evidence. At the preserved ROW-65 baseline
(`7ee3b17`), all seven files under `plugins/git/merge-evidence/` (about 21 MB) contained only decisions
with the reason `parent retained for edited descendants`. Each concerned a Story absent from BASE and present on one side only: a
plain addition, with nothing deleted and nothing chosen. Each record also embeds every Data Root
file of all three sources, so one spurious decision costs a few megabytes and turns an otherwise
fast-forward synchronization into a merge commit.

Nothing said how long Merge Evidence is kept, or how a person may clean it up without losing what an
audit needs. Pull requests here also link screenshots from orphan `pr-assets/<branch>` branches,
which a cleanup of merged branches could delete.

## 2. Decision

### 1. A one-sided addition is not a decision

Deletion intent needs the parent record (`story.json` or `board.config.json`) in BASE. A parent absent
from BASE and added with its descendants on one side merges as an addition: no decision and no
evidence. When BASE has the parent, one side deletes it and the other edits or adds a descendant, the
parent and its subtree are retained with evidence as before.

Everything else in ADR-0034 is unchanged. Every attempt still reconciles BASE and both sources,
including when one source equals BASE, with the same concurrency rules, ordering and evidence for
real alternatives, deletion intent and repairs.

### 2. Merge Evidence is append-only audit history

- A Merge Evidence file is never edited. Its content address and the commit that adds it are its
  audit record; the run summary's `last.evidence` names its path.
- Rowbly never expires, prunes or garbage-collects Merge Evidence.
- A file may be removed only with explicit user approval and an ordinary commit on the upstream
  branch, never by rewriting history, and only after the adding merge commit is upstream and its
  decisions have been reviewed: each chosen value was checked, or the record was confirmed spurious.
  Before removing it, record the path, the commit that added it (`git log --diff-filter=A -- <path>`),
  the review outcome and the approval in the removal commit message; the file stays readable with
  `git show <commit>:<path>`.
- Evidence or a Rowbly conflict does not by itself say who wrote the sources. Check their provenance
  (the commits and what merged them) and report a conflict nobody has resolved, keeping every side.

Records written before this decision are kept until the user approves removal after review as above.
No existing evidence is removed by this change.

### 3. Linked screenshot branches are kept

In this repository, a `pr-assets/<branch>` branch holds screenshots that pull request comments link
by branch name. It is pull request evidence: keep it after the pull request merges or closes, with no
expiry, and leave it out of completion cleanup. Delete one only with the user's approval, after every
linked image is hosted elsewhere and the comments that link it are updated and load.

## 3. Rejected alternatives

- **Skip reconciliation when one source equals BASE.** It would remove most synchronization merge
  commits, but it changes ADR-0034 §2, which reconciles every attempt. It is not decided here.
- **Keep only the files that differ in each source's evidence.** It would shrink records by orders
  of magnitude, but it changes the stored format and needs care for rebased sources whose commits do
  not stay in history. Deferred.
- **Expire or prune evidence automatically.** An audit could no longer find what a merge chose.
- **Rewrite history to reclaim space.** Rowbly never force-pushes; clones and open branches would
  diverge.
