# Website screenshots

These images come from the real built CLI of Rowbly v0.17.0. The terminal has 170 columns and 46
rows. Headless Chrome renders the ANSI output of the terminal at 2x scale.

The demo Project is "Tic-Tac-Toe" (key `TTT`) in a temporary folder. A local stub model server
gives the answers of the factory agents. The models `local/opus` and `local/sol` are names of this
stub. No real model and no real credential was used.

Use the alt text below when a page shows an image.

| File                   | Alt text                                                                                                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `board.png`            | The Rowbly board with 23 Stories in five Stages. Agent tags show the model of the worker on each active Story. One Story waits for the Story that it depends on.                              |
| `threads.png`          | The Threads view with seven running and four failed worker Threads. The open Thread shows its status, model and worktree, the end of the user message and two agent messages with tool calls. |
| `factory-controls.png` | The Factory controls on the board. They show the status, the supervisor model, the worker counts, one Attention row and the queue of Stories.                                                 |
| `settings-models.png`  | Settings > AI > Models. It shows the supervisor model, the worker model and the worker model of each Stage.                                                                                   |
| `settings-limits.png`  | Settings > AI > Limits. It shows the worker limit of nine workers and the Pull upstream Stories switch.                                                                                       |
| `story-general.png`    | An open Story in the General tab, next to the board. It shows the title, the Stage, the description, the worktree and the Story that it blocks. The Specs tab shows one linked Spec.          |
