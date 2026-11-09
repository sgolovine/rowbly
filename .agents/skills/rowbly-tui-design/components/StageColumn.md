# StageColumn

A StageColumn shows one Stage on the Board. It shows the Stage name, a rule and then the Stories of the Stage in Rank order.

- Header: The `●` and the Stage name are in the Stage Category colour. The count follows in `ink-faint`, without brackets (`● Done 8`).
- Rule: The rule is `━` in `accent` under the Stage in focus, and `─` in `border` under the other Stages.
- The Stories have no gap between them. Their frames stack. When the Stage scrolls, `↑ N more` / `↓ N more` shows in `ink-faint`.
- Empty: An empty Stage shows `No Stories` in `ink-faint`.
- All StageColumns have the same width, with `col-2` between them.
