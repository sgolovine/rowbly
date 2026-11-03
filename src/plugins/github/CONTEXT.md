# GitHub

## Language

**GitHub PR**:
A GitHub pull request linked to a Story by its HTTPS URL. Each Story has at most one. Its live
status is read with GitHub CLI (`gh`) and is never saved in the Data Root.
_Avoid_: merge request, pull request field


**Linked PRs**:
The number of unique GitHub PR identities currently linked to existing Stories on one Board.
Aliases resolving to one PR count once. A source that cannot resolve every identity is partial or
unavailable, never an exact count of the stored URLs.
_Avoid_: historical PRs

**Commits in linked PRs**:
The number of unique full commit SHAs read from the Board's currently linked GitHub PRs. A PR
contributes only a complete validated list. Partial values are known lower bounds; unavailable
values are not zero. No repository-wide history or deleted Story history is inferred.
_Avoid_: estimated commits
