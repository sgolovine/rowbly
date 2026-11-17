# Rowbly website

This folder has the marketing website of Rowbly. The site is served at `https://rowbly.com`.

The website uses TanStack Start, Tailwind CSS v4 and shadcn/ui. The build prerenders each page to static
files for GitHub Pages.

The website is the `rowbly-website` package of the pnpm workspace. It is in `packages/website/`. It has its
own `package.json`, but the root of the repository has the only `pnpm-workspace.yaml` and `pnpm-lock.yaml`. Do
not add website dependencies to the root package or to `packages/cli/`. To add a dependency, run this command
from the root of the repository:

```sh
pnpm --filter rowbly-website add <name>
```

## Install

Run this command from the root of the repository. It installs the dependencies of all packages:

```sh
pnpm install
```

## Run the development server

Run one of these commands from the root of the repository:

```sh
pnpm website:dev
pnpm --filter rowbly-website dev
```

The server shows the URL of the site in the terminal.

## Build

Run one of these commands from the root of the repository:

```sh
pnpm website:build
pnpm --filter rowbly-website build
```

The build writes the static site to `packages/website/dist/client/`. This folder has `index.html`, and the CSS, the
scripts and the font files in `assets/`. Deploy only this folder.

The build also writes `packages/website/dist/server/`. The prerender step uses it. Do not deploy it.

The build writes one HTML file for each prerendered route, for example `install/index.html` for `/install`.
GitHub Pages serves each of these files directly.

The build also writes `404.html` from the `/404` route. After the build, `scripts/make-static-404.mjs` removes
the scripts from this file, so that the 404 page is static HTML. GitHub Pages serves this page for each
unknown path. The files in `public/` (for example `CNAME`, `.nojekyll` and `robots.txt`) go into the output
without changes.

## Deploy

The workflow `.github/workflows/website.yml` deploys the site to GitHub Pages. It starts when:

- A push to `main` changes `packages/website/`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` or the workflow. The
  workflow builds and deploys the site.
- A pull request changes `packages/website/`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` or the workflow. The
  workflow only builds the site. It does not deploy it.
- A person starts the workflow manually from the Actions tab ("Run workflow"). The workflow builds and deploys
  the site.

The `build` job installs only the dependencies of the website, builds the site, checks the types and makes sure that
`dist/client/` has `index.html`, `404.html`, `CNAME`, `.nojekyll`, `sitemap.xml`, `robots.txt` and
`images/og-image.png`. Then it uploads `dist/client/` as the
Pages artifact. The `deploy` job publishes the artifact. Only one deploy runs at a time. A new deploy does not
cancel a deploy that is in progress.

### Turn on GitHub Pages

Do this step one time. You must be an owner of the repository.

1. Open Settings > Pages of the repository.
2. Set "Source" to "GitHub Actions".

### Set up the custom domain

The site is served at `https://rowbly.com`. The file `public/CNAME` has the domain `rowbly.com`. Each deploy
includes this file, so the deploy keeps the custom domain.

Do these steps one time:

1. At the DNS provider of `rowbly.com`, add these records for the apex domain:
   - `A` records: `185.199.108.153`, `185.199.109.153`, `185.199.110.153` and `185.199.111.153`.
   - `AAAA` records: `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153` and
     `2606:50c0:8003::153`.
2. At the DNS provider, add a `CNAME` record from `www` to `sgolovine.github.io`.
3. In Settings > Pages, set "Custom domain" to `rowbly.com` and click "Save".
4. When the DNS check passes, turn on "Enforce HTTPS". The TLS certificate can take some time to be ready.
5. Optional: verify the domain in the settings of your GitHub account (Settings > Pages > Verified domains).
   This prevents a domain takeover.

## Check the types

Run the build or the development server one time before you check the types. TanStack Start generates the
route tree `src/route-tree.gen.ts` when it starts. Git does not track this file.

Run one of these commands from the root of the repository:

```sh
pnpm website:typecheck
pnpm --filter rowbly-website typecheck
```

## Lint

The root `pnpm lint` also checks the website. Run it from the root of the repository.

## Add a shadcn/ui component

1. Run the shadcn CLI in the `packages/website/` folder:

   ```sh
   cd packages/website
   pnpm dlx shadcn@latest add <component>
   ```

2. Make sure that each new file imports `cn` from `@/lib/utils`. If the CLI writes `from "cn"`, change the
   import, and remove the `cn` package from `package.json`.
3. Format the new files from the root of the repository:

   ```sh
   pnpm exec biome check --write packages/website
   ```

4. Run the root `pnpm lint` and `pnpm website:typecheck`.

The components are in `src/components/ui/`. Each file name must be dash-case.

## Colours and fonts

The brand colours are Tailwind theme variables in `src/styles/app.css`, for example `bg-brand-background`
and `text-brand-accent`. The shadcn/ui variables use these colours. The site has only a dark theme. Do not
add other hues.

The fonts are JetBrains Mono (`font-mono`) and Inter (`font-sans`). The `@fontsource-variable` packages
supply the font files, and the build copies them into the output. The site does not request fonts from a
CDN.

## Layout and shared components

The root route `src/routes/__root.tsx` shows the header (`src/components/site-header.tsx`), the page content
in `<main>` and the footer (`src/components/site-footer.tsx`) on each page.

Use these shared components in `src/components/` for the pages:

| Component        | File                  | Use                                                                  |
| ---------------- | --------------------- | -------------------------------------------------------------------- |
| `Section`        | `section.tsx`         | A page section with an `id`, an eyebrow, a headline and a subhead    |
| `TerminalFrame`  | `terminal-frame.tsx`  | A terminal window frame for an image or content. `glow` adds a glow  |
| `InstallCommand` | `install-command.tsx` | A command with a `$` prompt and a copy button. Set it with `command` |
| `Kbd`            | `kbd.tsx`             | A keycap for a key, for example `f`                                  |
| `AgentTag`       | `agent-tag.tsx`       | A mono tag with an agent name and a Stage label                      |

The external URLs of the header and the footer are in `src/lib/site.ts`.

## Icons and images

The icons in `public/` come from `assets/icon.png` (400x400) at the root of the repository. They are
`favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png` (180x180) and `icon-512.png`. The 512 px
icon is an upscale with a Lanczos filter. The icons are committed files. The build does not make them.

To make the icons again, use an image tool one time, for example:

```sh
magick assets/icon.png -filter Lanczos -resize 32x32 packages/website/public/favicon-32x32.png
```

`public/site.webmanifest` refers to `icon-512.png`.

`public/images/` has copies of `assets/screenshot.png`, `assets/header.png` and `assets/icon.png`. If you
change a file in `assets/`, copy it again.

The pages show `board.webp` and `board-no-tags.webp`. These files are lossless WebP copies of `board.png` and
`board-no-tags.png`. They are approximately 80% smaller than the PNG files. If you change a PNG file, make the
WebP file again, for example:

```sh
cwebp -lossless -z 9 packages/website/public/images/board.png -o packages/website/public/images/board.webp
```

## Site URL

`src/lib/site.ts` exports `SITE_URL`. Use this constant for each absolute URL of the site.

## SEO

### Page head

`src/lib/seo.ts` has the SEO helper `pageHead({ path, title, description })`. It gives the `meta` and `links`
of the route `head` for one page:

- The `<title>` and the meta description.
- The canonical link. The home URL is `https://rowbly.com/`. Other URLs have no trailing slash, for example
  `https://rowbly.com/install`.
- The Open Graph tags (`og:*`) and the Twitter card tags (`twitter:*`). All pages use the same OG image.

Use `pageHead` in the `head` of each page that search engines must index. A child route `head` overrides the
`title` of the root route and each meta tag with the same `name` or `property`.

The home route `src/routes/index.tsx` also adds the `SoftwareApplication` JSON-LD with
`softwareApplicationScript()`. Only the home page has JSON-LD.

The `/404` route does not use `pageHead`. It has a `noindex` meta tag, and it has no canonical link and no OG
tags.

### OG image

`public/images/og-image.png` is the social card image (1200x630 PNG). The image has the `rowbly_` wordmark in
JetBrains Mono with the amber cursor, the text "Your backlog, built by a factory of agents." in Inter, a crop
of the agent tags of `public/images/board.png` and an amber line at the bottom. It uses only the brand
colours.

The image is a committed file. The build does not make it. To make the image again, do these steps one time:

1. Make a temporary HTML page of 1200x630 px. Use the brand colours, and load the fonts from the
   `@fontsource-variable` packages in `node_modules/`.
2. Take a screenshot with a headless browser, for example:

   ```sh
   google-chrome --headless=new --hide-scrollbars --force-device-scale-factor=1 \
     --window-size=1200,630 --screenshot=packages/website/public/images/og-image.png file:///tmp/og/og.html
   ```

3. Make sure that `file packages/website/public/images/og-image.png` shows `1200 x 630`. Keep the file small (less
   than 300 KB).

Do not commit the HTML page. Do not add a dependency or a build step for the image.

### Sitemap and robots.txt

The `sitemap` option of the `tanstackStart()` plugin in `vite.config.ts` writes `dist/client/sitemap.xml`.
The host is `SITE_URL`. The sitemap has each prerendered page. The prerender crawl finds `/how-it-works` and
`/install`. The `/404` page entry has `sitemap: { exclude: true }`, so the sitemap does not have it. The
sitemap step also writes `dist/client/pages.json`. Search engines do not use this file.

`public/robots.txt` allows all crawlers and gives the URL of the sitemap.
