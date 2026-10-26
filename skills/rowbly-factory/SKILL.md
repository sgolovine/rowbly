---
name: rowbly-factory
description: Run when user invokes `rowbly-factory`
---

This skill kickstarts a new software factory

## Prior to Beginning

- Check that you are in an enviorment that supports sub-agents and spawning threads. If you are not able to do this then you should exit and tell the user this capability is required for this skill.

- If you are running inside of a project, ensure that the project either has one board or the user has specified a board when they ran the skill. If you are not sure of which board to use, exit the skill and instruct the user to re-run and specify the board that should be used.

- Once you have the board you are running, pull column prompts for each column on the board. Then validate each column prompt and ensure that you have access to everything that prompt requires. If you do not have access to a skill or anything else, tell the user what is missing and then exit.

<!-- Column prompts are not defined yet. Must add feature before this works. -->

## Process

- You are to act as a supervisor

- Monitor the board for any changes:
  - Cards created
  - Cards moved

- When a card is moved, look at the column prompt for the column it was moved to. If the column does not have a prompt then take no action, otherwise spawn a new worker thread and execute the prompt inside the column.

- Column prompts are responsible for instructing the agent on where to move the card next or whether to keep it in the current column. 

- Once a card in a column is acted upon, take no further action on that card within that column. Action after this point is only taken when the story is moved to another column that contains a column prompt.


