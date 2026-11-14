---
title: Check the website for accessibility, motion and performance
stage: IN_REFINEMENT
position: 15
worktree: null
pull_request: null
---

## Goal

Check the whole website for accessibility, motion, performance and layout before the launch, and repair the problems.

## Scope

- Run Lighthouse on `/`, `/how-it-works` and `/install` (mobile and desktop).
- Check `prefers-reduced-motion: reduce`: all loops, count-ups, typing and fades stop and show the final state.
- Check keyboard navigation: visible focus on every link, button, tab and tooltip; a "Skip to content" link.
- Check colour contrast of muted text and amber text on the dark background (WCAG AA).
- Check layout at 360, 390, 768, 1024, 1280 and 1440 px wide.
- Check that all images have alt text and that decorative images have empty alt.
- Check that the total weight of the home page is less than 1 MB on first load.

## Acceptance criteria

- [ ] Lighthouse scores of 90 or more for Performance, Accessibility, Best Practices and SEO on all three pages (mobile).
- [ ] No horizontal scroll at any of the listed widths.
- [ ] All motion respects reduced motion.
- [ ] The PR lists each problem found and its repair.

## Technical notes

Do this Story after the page Stories are done.
