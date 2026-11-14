# Domain concepts

Rowbly has a small set of domain concepts. Use these names in code, services, commands and UI text.
Do not use a different word for the same concept. For example, a Stage is not a "column" or a "step".

Read this when you name a new type, command or UI label, or when you must know how the concepts
relate.

## The concept tree

```
Project ── configuration: custom field definitions, stages (each with an optional prompt)
  ├── Factory ── native supervisor and independent workers
  │     └── Thread ── one Pi session, with one or more runs
  └── Story ── custom field values, exactly one stage, optional PNG attachments
        ├── Thread ── the history of one worker attempt
        └── Spec ── a Markdown document, linked to one or more stories
```

## Project

The Project is the top-level concept. Rowbly keeps all of its data in a Project. Data at the "top
level" is data at the Project level. Each Project has a configuration that sets how the Project
operates. The configuration contains the custom fields and the Stages of the Project.

A Project also has user prompts in `.rowbly/prompts/`. The Project prompt goes to all agents of the
factory. The Supervisor prompt and the Worker prompt go to one role. See [prompts.md](prompts.md).

## Story

A Project contains Stories. You define each custom field one time, at the Project level. The field
then applies to all Stories in that Project, and each Story has its own value for it. Each Story is in
a Stage. A Story can have PNG attachments. See [storage.md](storage.md#attachments).

## Stage

You define Stages at the Project level, and they apply to all Stories of the Project. Each Story in a
Project **must** have a Stage.

- Each Project from `rowbly init` or the TUI starts with the Stages that onboarding selects.
- Users can add more Stages.
- Each Stage can have a prompt. The prompt tells agents what to do with a Story in that Stage. Only
  the workers of that Stage get it.
- The order of the Stages in the config is the order of the board.

## Spec

A Spec is a Markdown document that describes the work of a Story. A Spec must have a link to at least
one Story, and a Story can have many Specs.

Specs are an optional feature. Each Project starts with Specs off. Turn them on in the Specs section
of Settings, or with `rowbly project update --specs on`. When Specs are on, an open Story has a Specs
tab between the General tab and the Attachments tab.

## Factory

The native factory runs a Pi supervisor and independent Pi workers in a separate daemon. The manager
controls ownership, worker slots, worktrees, sessions, commands and recovery.

Rowbly does not bundle an external factory skill now. A Project can still have an old installed copy
of the `factory` skill. Never run that copy and the native factory together.

See [native-factory/README.md](native-factory/README.md).

## Thread

A Thread holds the metadata of one Pi session.

- A worker Thread belongs to one Story and one Stage attempt.
- A resume adds a run to the same Thread. A retry creates a new Thread.
- Supervisor Threads belong to the Factory.
- The history of a Thread stays after its Story is deleted.

See [native-factory/threads-and-history.md](native-factory/threads-and-history.md).

## Factory activity

The factory activity shows the workers in `.rowbly/state.json` for the current Stage of each Story.
The native factory writes this file under the state lock. An old external supervisor can also write
it. The activity reader does not examine if a worker is alive. The native factory controls examine
daemon ownership separately.

See [native-factory/factory-activity.md](native-factory/factory-activity.md).

## Related

- [storage.md](storage.md): the files of each concept.
- [service-layer.md](service-layer.md): the service module of each concept.
