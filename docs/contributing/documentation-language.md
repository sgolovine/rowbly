# Documentation language: ASD-STE100

Write all documentation in ASD-STE100 Simplified Technical English (STE). This rule applies to
`AGENTS.md`, to all files in `docs/` and `.agents/skills/`, and to all other Markdown documents in
this repository. It applies to new text and to changes in old text.

Read this when you write or change a Markdown file.

## Scope

The STE rules apply to prose. Do not change code blocks, commands, file paths, identifiers, key names
or text that the UI shows.

Exception: `.agents/skills/agentic-tui/SKILL.md` is a copy of an upstream file. Do not change it. Its
`UPSTREAM.md` is our file, and the STE rules apply to it.

## Words

- Use only the words in the STE dictionary, and use each word only with its approved meaning.
- Use one word for one meaning. If you use "stage" for a concept, do not also call it "column" or
  "step".
- You can use technical names and technical verbs. Technical names include file names, commands,
  flags, components, keys and the domain concepts (Project, Story, Stage). Technical verbs include
  "run", "build", "render", "commit" and "push".
- Use the approved word, not the unapproved word:

  | Do not use       | Use                                 |
  | ---------------- | ----------------------------------- |
  | should, shall    | must, or a command                  |
  | may, might       | can                                 |
  | ensure           | make sure                           |
  | need, require    | must, or "it is necessary"          |
  | allow            | let, or can                         |
  | avoid            | do not use, or prevent              |
  | via              | through                             |
  | e.g., i.e., etc. | for example, that is, the full list |

## Sentences

- A procedural sentence (an instruction) has a maximum of 20 words. A descriptive sentence has a
  maximum of 25 words.
- Write one instruction in each sentence.
- Write instructions as commands: "Run `pnpm lint`", not "You should run `pnpm lint`".
- Use the active voice. Use the passive voice only in descriptive text, and only when it is necessary.
- Use only the simple tenses: present, past and future.
- Do not use the "-ing" form of a verb, except in a technical name.
- Do not leave out words such as "the", "a" or verbs to make a sentence shorter. Headings, table
  cells and list labels can be short phrases.
- Do not use a noun cluster of more than three words. A technical name is not a noun cluster.
- Use a vertical list for a sequence of steps or for three or more items.

## Paragraphs and warnings

- Write about one topic in each paragraph. Start with the topic sentence.
- A paragraph has a maximum of six sentences.
- Start a warning with a command. Then give the reason in a second sentence.

## Structure of a documentation page

The pages in `docs/` use progressive disclosure, so that a reader gets only the facts for the task:

1. Start with a summary of two to four sentences.
2. Add a "Read this when …" sentence.
3. Give the details.
4. End with a "Related" list of links.

Split a page when it becomes longer than approximately 250 lines. Use relative links, and make sure
that each link target exists.

## Related

- [AGENTS.md](../../AGENTS.md): the short form of this rule.
