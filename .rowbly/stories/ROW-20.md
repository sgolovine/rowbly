---
title: Allow overriding AI worker model
stage: IN_REFINEMENT
position: 1
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-20
pull_request: null
---

Allow overriding a worker model

- Override at stage level
- Override at story level


Ie: for a stage i can override the model and that new model shall be used for all stories within that stage

I can also override the model per stage per story. So I can say "for this story, I want to use X model in Refinement and Y model in Development". This overrides any stage level overrides


The order is:

- Story level overrides (highest priority)
- Stage level overrides (medium priority, only triggered if there is no story level one)
- Settings level model, only used if ther is no stage or story level overrides
