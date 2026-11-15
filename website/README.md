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

The build writes one HTML file for each prerendered route, for example `install/index.html` for `/install`.
GitHub Pages serves each of these files directly.

The build also writes `404.html` from the `/404` route. After the build, `scripts/make-static-404.mjs` removes
the scripts from this file, so that the 404 page is static HTML. GitHub Pages serves this page for each
unknown path. The files in `public/` (`CNAME` and `.nojekyll`) go into the output without changes.

## Deploy

The workflow `.github/workflows/website.yml` deploys the site to GitHub Pages. It starts when:

- A push to `main` changes `website/` or the workflow. The workflow builds and deploys the site.
- A pull request changes `website/` or the workflow. The workflow only builds the site. It does not deploy it.
- A person starts the workflow manually from the Actions tab ("Run workflow"). The workflow builds and deploys
  the site.

The `build` job installs the dependencies, builds the site, checks the types and makes sure that
`dist/client/` has `index.html`, `404.html`, `CNAME` and `.nojekyll`. Then it uploads `dist/client/` as the
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

## Site URL

`src/lib/site.ts` exports `SITE_URL`. Use this constant for each absolute URL of the site.
