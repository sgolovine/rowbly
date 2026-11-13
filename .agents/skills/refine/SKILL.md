---
name: refine
description: Refine a Rowbly Story from an agent or a person so that it has all the information for development. Use when a Story is in refinement or the user asks to refine a Story.
---

# Refine

This skill makes one Story ready for development. Do not write code in this skill.

Read `references/rowbly-reference.md` before you run a `rowbly` command.

Run each `rowbly` command as `rowbly -C <root> --json ...`.

- A factory worker uses the `<root>` value of its first message.
- Other agents use the main checkout as `<root>`. It is the first entry of `git worktree list`.

## Procedure

1. Read the Project instructions (`rowbly -C <root> --json project get-instructions`), the Story and its Specs.
2. Read the code and the repository instructions that apply to the Story.
3. Write the description again with the sections below. Keep all the facts and the intent of the author.
4. Answer each question that the code can answer.
5. Make a decision for each other question. See "Questions".
6. If one pull request cannot hold the work, split the Story. See "A Story that is too large".
7. Save the description with `story update`.

## Questions

A question must not stop a Story. For each question that the code cannot answer, do these steps:

1. Look for the answer in the Story, its Specs, the Project instructions and the Git history.
2. If a person started you and answers in this conversation, ask the person one time.
3. If you are a factory worker, do not ask. No person will answer.
4. If you have no answer, make the decision yourself.
5. Select the option with the smallest scope that agrees with the intent of the author and the existing code.
6. Write the decision and its reason in `## Assumptions`.

A person can change an assumption later. A Story that waits for an answer does not move.

## A Story that is too large

Do not report `blocked` for a Story that is too large. Split it.

Do not split a Story that has `Split from` at the start of its description. Reduce its scope to one pull request, and write the work that you removed in `## Scope` as work that is not in scope.

To split a Story, do these steps:

1. Keep in this Story the first part that has a result of its own.
2. Create one new Story for each other part, with `story create`. Use the Stage of this Story.
3. Start the description of each new Story with `Split from <story-id>.` Then give the goal of that part.
4. Create a maximum of 5 new Stories. If more parts stay, put them together in the last new Story.
5. Write the ID of each new Story in `## Scope` of this Story, as work that is not in scope.

Do not refine the new Stories now. Each of them gets its own refinement.

## Description

```markdown
## Goal

The problem and the result that the user gets.

## Scope

What is in scope, and what is not in scope.

## Acceptance criteria

- [ ] One condition that a person or a test can examine.

## Technical notes

The files, services, commands and constraints that apply.

## Assumptions

- One decision that you made without the author. Reason: the reason for the decision.

Remove this section if you made no decisions.
```

Write each acceptance criterion so that a test or a command can examine it. If only a person can examine a criterion, say so in the criterion.

Keep a `## Blockers` section only for a blocker that still applies. Remove a blocker that has a solution.

## Result

Report `ready` if the Story agrees with all these conditions:

- A developer with no other information can start the work.
- A person or a test can examine each acceptance criterion.
- Each question has an answer or an assumption.
- One pull request can hold the work.

If a condition is not satisfied, do the procedure again for that condition. Then report `ready`.

Report `blocked` only if you cannot understand the goal of the Story from its text, its Specs and the repository.
A factory worker can also report `blocked` in the conditions of its first message.
Before you report `blocked`, write the `## Blockers` section in the Story description: the problem, the methods that you tried and the action that a person must do.

Do not move the Story. The Stage prompt sets the next Stage.
