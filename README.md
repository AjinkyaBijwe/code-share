# CodePad — Zero-Auth Polyglot Code Editor & Sandbox

Browser-based multi-file code editor and execution sandbox built with **Angular 22** (Standalone Components, Signals, `OnPush`), **Tailwind CSS v4** + **shadcn/ui** design tokens, **Monaco Editor**, **Sandpack Client**, and **Pyodide**.

## Features

- **Zero-Login Sharing**: Compresses multi-file workspaces with `lz-string` (`#code=...` or `?pad=...`) and auto-saves locally to IndexedDB (`idb-keyval`). Supports optional `/api/snapshot` short links and `.zip` export (`fflate`).
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
