# CodePad — Zero-Auth Polyglot Code Editor & Sandbox

Browser-based multi-file code editor and execution sandbox built with **Angular 22** (Standalone Components, Signals, `OnPush`), **Tailwind CSS v4** + **shadcn/ui** design tokens, **Monaco Editor**, **Sandpack Client**, and **Pyodide**.

## Features

- **Zero-Login Sharing**: Compresses multi-file workspaces with template-delta diffing + `fflate` DEFLATE / `lz-string` (`#code=...` or `?pad=...`, down to **3 chars** for starter templates) and supports `<= 8`-char short snapshot slugs (`#s=Ab3k9Z` / `?s=Ab3k9Z` / `/s/Ab3k9Z`) backed by `edge/snapshot-worker.ts`, auto-saves to IndexedDB (`idb-keyval`), and exports `.zip` archives (`fflate`).
- **Pre-Configured Templates**: TypeScript, Angular Standalone + Signals, React + TS, and Python 3 (Pyodide WASM Web Worker with `micropip` support from `requirements.txt`).
- **Multi-File Monaco Editor**: Per-file `ITextModel` tabs, cross-file TypeScript IntelliSense, Prettier formatting (`Shift + Alt + F`), and keyboard shortcuts (`Cmd/Ctrl + S` to sync & copy link, `Cmd/Ctrl + Enter` to run).
- **Live Preview & Unified Console**: Resizable 3-pane layout, responsive viewport toggles (`Desktop` / `Tablet` / `Mobile`), Fullscreen preview mode (`Esc` to exit), and log-level console filtering.

## Development

```bash
npm install
npm start
```

Open `http://localhost:4200/` in your browser.

## Unit Tests & Production Build

```bash
npm run test:ci
npm run build
```

## GitHub Pages Deployment

Automatic deployment is configured in [`.github/workflows/deploy-gh-pages.yml`](.github/workflows/deploy-gh-pages.yml) on every push to `main` (and via manual `workflow_dispatch`).

1. Push this repository to GitHub with `main` as the default branch.
2. In your GitHub repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Every push to `main` runs `npm run test:ci`, builds with the dynamic `--base-href` from `actions/configure-pages`, adds `404.html` + `.nojekyll`, and deploys `dist/codepad/browser`.

To verify a GitHub Pages subpath build locally:

```bash
npm run build:gh-pages
```

## Short Snapshot Links (<= 8-Char Slugs)

[`edge/snapshot-worker.ts`](edge/snapshot-worker.ts) provides a lightweight zero-auth snapshot API (supporting **Cloudflare Workers KV** or **Upstash Redis REST**) that generates 6–8 character Base62 IDs (`#s=Ab3k9Z`) with a sliding 30-day TTL and CORS enabled for GitHub Pages.

1. Configure either a `CODEPAD_KV` namespace in [`wrangler.toml`](wrangler.toml) or set Upstash secrets:
   ```bash
   npx wrangler secret put UPSTASH_REDIS_REST_URL
   npx wrangler secret put UPSTASH_REDIS_REST_TOKEN
   ```
2. Deploy the worker:
   ```bash
   npx wrangler deploy
   ```
3. Paste the deployed `https://<worker>.workers.dev` URL into the Share dialog's Short Link endpoint field (saved in `localStorage`) or set `<meta name="codepad-snapshot-endpoint" content="https://<worker>.workers.dev" />` in [`src/index.html`](src/index.html).
