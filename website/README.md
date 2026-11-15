# Rowbly website

This folder has the marketing website of Rowbly. The site is served at `https://rowbly.com`.

The website uses TanStack Start, Tailwind CSS v4 and shadcn/ui. The build prerenders each page to static
files for GitHub Pages.

The website is a separate pnpm package. It has its own `package.json`, its own `pnpm-workspace.yaml` and its
own `pnpm-lock.yaml`. Do not add website dependencies to the root package.

## Install

Run this command from the root of the repository:

```sh
pnpm --dir website install
```

## Run the development server

Run one of these commands from the root of the repository:

```sh
pnpm website:dev
pnpm --dir website dev
```

The server shows the URL of the site in the terminal.

## Build

Run one of these commands from the root of the repository:

```sh
pnpm website:build
pnpm --dir website build
```

The build writes the static site to `website/dist/client/`. This folder has `index.html`, and the CSS, the
scripts and the font files in `assets/`. Deploy only this folder.

The build also writes `website/dist/server/`. The prerender step uses it. Do not deploy it.

## Check the types

Run the build or the development server one time before you check the types. TanStack Start generates the
route tree `src/route-tree.gen.ts` when it starts. Git does not track this file.

```sh
pnpm --dir website typecheck
```

## Lint

The root `pnpm lint` also checks the website. Run it from the root of the repository.

## Add a shadcn/ui component

1. Run the shadcn CLI in the `website/` folder:

   ```sh
   cd website
   pnpm dlx shadcn@latest add <component>
   ```

2. Make sure that each new file imports `cn` from `@/lib/utils`. If the CLI writes `from "cn"`, change the
   import, and remove the `cn` package from `package.json`.
3. Format the new files from the root of the repository:

   ```sh
   pnpm exec biome check --write website
   ```

4. Run the root `pnpm lint` and `pnpm --dir website typecheck`.

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
magick assets/icon.png -filter Lanczos -resize 32x32 website/public/favicon-32x32.png
```

`public/site.webmanifest` refers to `icon-512.png`.

`public/images/` has copies of `assets/screenshot.png`, `assets/header.png` and `assets/icon.png`. If you
change a file in `assets/`, copy it again.

## Site URL

`src/lib/site.ts` exports `SITE_URL`. Use this constant for each absolute URL of the site.
