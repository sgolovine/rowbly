---
name: refine
description: Refine a Rowbly Story from an agent or a person so that it has all the information for development. Use when a Story is in refinement or the user asks to refine a Story.
---

# Refine

This skill makes one Story ready for development. Do not write code in this skill.

Read `references/rowbly_reference.md` before you run a `rowbly` command.

## Procedure

1. Read the Project instructions (`rowbly project get-instructions --json`), the Story and its Specs.
2. Read the code and the repository instructions that apply to the Story.
3. Write the description again with the sections below. Keep all the facts and the intent of the author.
4. Answer each question that the code can answer.
5. Ask the user each question that only the user can answer.
6. Write each question that has no answer in `## Open questions`.
7. Save the description with `story update`.

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

## Open questions

Only the questions that have no answer. Remove this section if there are no questions.
```

## Result

Report `ready` if the Story agrees with all these conditions:

- A developer with no other information can start the work.
- A person or a test can examine each acceptance criterion.
- The Story has no open questions.
- One pull request can hold the work.

Otherwise, report `blocked` and give the reasons. If the Story is too large, propose a split.

Do not move the Story. The Stage prompt sets the next Stage.
