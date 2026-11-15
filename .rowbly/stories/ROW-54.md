---
title: Add SEO metadata, the OG image and the sitemap to the website
stage: IN_REVIEW
position: 1
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-54
pull_request: https://github.com/sgolovine/rowbly/pull/250
---

## Goal

Make the Rowbly website look good when people share a link to it, and make it easy to find in search. Each page gets a correct title, description, canonical URL and social card. The home page gets structured data. The build writes `sitemap.xml` and `robots.txt`.

## Scope

In scope:

- Per-page `<title>` and meta description through the TanStack Start `head` API of each route.
  - Home (`/`) title: "Rowbly: a software factory manager in your terminal"
  - Home description: "Keep a Kanban board of Stories in your Git repo. Give each Stage a prompt. Start the factory and a team of AI agents refines, builds and reviews in parallel."
  - `/how-it-works`: keep the title and description that ROW-52 added ("How it works | Rowbly" and its description). Add the canonical, Open Graph and Twitter tags.
  - `/install` title: "Install | Rowbly". Description: "Install Rowbly with npm, open it in your Git repo and start the factory. Free and open source under MIT. Needs Node 22. The factory runs on Linux today."
- Canonical URLs on `https://rowbly.com`, made from `SITE_URL` in `website/src/lib/site.ts` (ROW-45). Home: `https://rowbly.com/`. Other pages: `https://rowbly.com/how-it-works` and `https://rowbly.com/install` (no trailing slash).
- Open Graph tags (`og:type`, `og:site_name`, `og:title`, `og:description`, `og:url`, `og:image`, `og:image:width`, `og:image:height`, `og:image:alt`) and Twitter card tags (`twitter:card` = `summary_large_image`, `twitter:title`, `twitter:description`, `twitter:image`) on `/`, `/how-it-works` and `/install`.
- An OG image, 1200x630 PNG, committed as `website/public/images/og-image.png`: near-black background (`#111214`), the `rowbly_` wordmark in JetBrains Mono with the amber (`#F5B841`) cursor, and "Your backlog, built by a factory of agents." on the left; a tight crop of the real board with agent tags (`website/public/images/board.png`) on the right; a thin amber line at the bottom. Use only the palette of the Spec, section 7.
- `SoftwareApplication` JSON-LD on the home page only: `name` "Rowbly", `url` `https://rowbly.com`, `applicationCategory` "DeveloperApplication", `operatingSystem` "Linux", `offers` with `price` "0" and `priceCurrency` "USD", `license` (MIT, `LICENSE_URL`), `downloadUrl` (`NPM_URL`), `codeRepository`/`sameAs` (`GITHUB_URL`), `description` (the home description), `image` (the OG image URL).
- `sitemap.xml` and `robots.txt` in `website/dist/client/`.

Not in scope:

- Changes to the page content or to the layout.
- The `/404` page: it keeps its `noindex` meta and gets no canonical, OG tags or sitemap entry.
- Search Console registration or other actions on external services.

## Acceptance criteria

- [ ] After `pnpm --dir website build`, `dist/client/index.html`, `dist/client/how-it-works/index.html` and `dist/client/install/index.html` each have exactly one `<title>`, one `<meta name="description">` and one `<link rel="canonical">`. The three titles are different, and the three descriptions are different.
- [ ] `dist/client/index.html` has the home title and the home description from Scope, and `<link rel="canonical" href="https://rowbly.com/">`.
- [ ] Each of the three pages has the `og:*` and `twitter:*` tags from Scope. `og:url` is the same as the canonical URL. `og:image` and `twitter:image` are `https://rowbly.com/images/og-image.png`.
- [ ] `website/public/images/og-image.png` exists and `file` reports `1200 x 630`. `dist/client/images/og-image.png` exists after the build.
- [ ] `dist/client/index.html` has one `<script type="application/ld+json">` with `"@type":"SoftwareApplication"` and `"url":"https://rowbly.com"`. The other pages have no JSON-LD.
- [ ] `dist/client/sitemap.xml` is valid XML and lists `https://rowbly.com/`, `https://rowbly.com/how-it-works` and `https://rowbly.com/install`, and no other URL (no `/404`).
- [ ] `dist/client/robots.txt` allows all crawlers and has `Sitemap: https://rowbly.com/sitemap.xml`.
- [ ] `dist/client/404.html` still has `noindex` and has no canonical link.
- [ ] The website workflow `.github/workflows/website.yml` also checks that `dist/client/` has `sitemap.xml`, `robots.txt` and `images/og-image.png`.
- [ ] Manual check (person, after deploy): a social card preview tool (for example opengraph.xyz) shows the OG image, title and description for `https://rowbly.com/`.
- [ ] Manual check (person, after deploy): the Google Rich Results test of `https://rowbly.com/` shows no errors for the JSON-LD.
- [ ] `pnpm lint`, `pnpm --dir website typecheck` and `pnpm --dir website build` pass.

## Technical notes

- The website is in `website/` (TanStack Start, static prerender for GitHub Pages). Read `website/README.md`. Install with `pnpm --dir website install`. Run the build once before `typecheck`, because the build generates `src/route-tree.gen.ts`.
- Routes: `website/src/routes/__root.tsx`, `index.tsx`, `how-it-works.tsx`, `install.tsx`, `404.tsx`. The root route sets `{ title: "Rowbly" }` and the icons. A child route `head` overrides `title` and meta with the same `name`/`property`.
- Put the head logic in one helper, for example `website/src/lib/seo.ts` with a function such as `pageHead({ path, title, description })`. It returns the `meta` and `links` (canonical) for a route. Use it in the three routes. Build each absolute URL from `SITE_URL`.
- JSON-LD: use the `scripts` field of the route `head` (`{ type: "application/ld+json", children: JSON.stringify(data) }`) in `index.tsx`. Make sure that the prerendered HTML has the script.
- Sitemap: TanStack Start has a `sitemap` option in the `tanstackStart()` plugin of `website/vite.config.ts` (`sitemap: { enabled: true, host: SITE_URL }`, with `sitemap: { exclude: true }` on the `/404` page entry). Use it if the installed version writes a correct file. If not, write `sitemap.xml` in a postbuild script in `website/scripts/` (like `make-static-404.mjs`) from a fixed list of the three paths. `/how-it-works` and `/install` are found by `crawlLinks`; add them to `pages` if the sitemap does not list them.
- `robots.txt`: a static file in `website/public/` is sufficient.
- OG image: the repository has no image tool in its dependencies. Make the image one time with any tool (for example ImageMagick, or a headless browser screenshot of a temporary HTML page) and commit only the PNG. Do not add a build step or a dependency for it. Use the fonts of the site (JetBrains Mono, Inter). Keep the file small (target under 300 KB).
- Update `website/README.md` (STE): the SEO helper, the OG image and how to make it again, the sitemap and `robots.txt`.
- ROW-53 (Install page) is in CHANGELOG on branch `story/ROW-53` and is possibly not merged in `main`. Its `install.tsx` has no `head`. If it is merged before this work, add the `head` to the new file. If not, add the `head` to the current file and expect a small merge.
- Spec: `website-content-plan`, section 8 (SEO) and section 7 (palette).

## Assumptions

- The `/install` title and description are new text from section 5 and 3.10 of the Spec. Reason: the Story gives only the home text, and the criterion "unique title and description" needs text for each page.
- `/how-it-works` keeps the title and description of ROW-52. Reason: the text exists and agrees with the Spec.
- Canonical URLs have no trailing slash, except the home URL. Reason: the links of the site use `/how-it-works` and `/install`, and GitHub Pages serves both forms.
- The OG image is at `public/images/og-image.png`. Reason: `public/images/` already holds the other site images.
- The JSON-LD uses `price` "0" with `priceCurrency` "USD" and `applicationCategory` "DeveloperApplication". Reason: Google Rich Results needs `offers` with a currency and a category for `SoftwareApplication`.
- The Google Rich Results test and the social card preview are manual checks after deploy. Reason: they are external services that need a public URL.
- The workflow check of the new files is in scope. Reason: it protects the new output in the same way as the existing check of `index.html` and `404.html`.
