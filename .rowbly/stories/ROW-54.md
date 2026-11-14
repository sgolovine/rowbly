---
title: Add SEO metadata, the OG image and the sitemap to the website
stage: BACKLOG
position: 12
worktree: null
pull_request: null
---

## Goal

Make the site look good when people share it and easy to find in search.

## Scope

- Per-page `<title>` and meta description through the TanStack Start head API.
  - Home title: "Rowbly: a software factory manager in your terminal"
  - Home description: "Keep a Kanban board of Stories in your Git repo. Give each Stage a prompt. Start the factory and a team of AI agents refines, builds and reviews in parallel."
- Canonical URLs on `https://rowbly.com`, made from the site URL constant of ROW-45.
- Open Graph and Twitter card tags on every page.
- An OG image, 1200x630, near-black background: the `rowbly_` wordmark with the amber cursor and "Your backlog, built by a factory of agents." on the left, a tight crop of the real board with agent tags on the right, a thin amber line at the bottom. Commit it as a static PNG.
- `SoftwareApplication` JSON-LD on the home page, with `url` `https://rowbly.com`: name, operating system Linux, price 0, license MIT, download URL on npm, repository URL.
- `sitemap.xml` and `robots.txt` in the build output.

## Acceptance criteria

- [ ] A link to the home page in a social card preview tool shows the OG image, title and description.
- [ ] The JSON-LD passes the Google Rich Results test without errors.
- [ ] `sitemap.xml` lists `/`, `/how-it-works` and `/install` with full URLs.
- [ ] Each page has a unique title and description.

## Technical notes

Depends on the layout Story. See the SEO section of the Spec `website-content-plan`.
