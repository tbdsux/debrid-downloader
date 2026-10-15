# AGENTS.md — Guide for LLMs working on this project

A desktop app (Electrobun) for downloading torrents, magnets, and direct links via debrid services (Real-Debrid, AllDebrid, TorBox, Premiumize, etc.) and saving the files locally.

## Critical rule: Electrobun is NOT Electron

Never use Electron APIs or patterns (`ipcMain`, `ipcRenderer`, `contextBridge`, `electron` imports, `preload.js` Electron-style). This app uses **Electrobun 2.x**:

- Main process: `import { BrowserWindow, createRPC, defineElectrobunRPC } from "electrobun/main"` — runs on **Cottontail** (a Zig/JSC runtime with Node/Bun-compatible APIs like `fetch`, `fs`, `Bun.$`).
- Webview side: `import { Electroview } from "electrobun/view"` — runs in a native OS webview (no Node APIs, no `require`, browser JS only).
- Docs: https://framework.blackboard.sh/electrobun/ (guides: quick-start, hello-world, hutch, cottontail)

## Project layout

```
src/
  bun/index.ts          # Main process (privileged: windows, network, filesystem, API keys)
  mainview/             # Webview UI (React 18 + Tailwind v4 + shadcn/ui)
    App.tsx             # Root component
    main.tsx            # React entry
    index.html          # Vite root
    index.css           # Tailwind v4 imports + shadcn theme vars + @theme inline mapping
    components/ui/      # shadcn components (button.tsx, ...)
    lib/utils.ts        # cn() helper
electrobun.config.ts    # App metadata, main-process runtime, asset copy map
hutch.config.ts         # hutch scripts + Electrobun version pin (do not edit pin casually)
vite.config.ts          # Vite config — root: src/mainview, outDir: dist, port 5173, @ alias, tailwindcss plugin
components.json         # shadcn CLI config
```

**Never edit or commit:** `.hutch/devkit/` (generated SDK), `.cottontail-tmp/`, `build/`, `dist/`, `hutch.lock` (regenerated). The SDK types under `.hutch/devkit/api/` are the source of truth for API signatures — grep them when unsure instead of guessing.

## Commands (always via hutch, never bare npm/yarn)

```bash
hutch run install        # reproducible install (frozen lockfile)
hutch run dev:hmr        # dev with Vite HMR (recommended during development)
hutch run dev            # dev without HMR (bundled assets, vite build first)
hutch run build:canary   # production build (canary env)
hutch run build          # production build (stable env)
```

Dependency management uses **Hutch's built-in npm-compatible resolver**:

- Add a dep: edit `package.json`, then run `hutch install`. Do NOT run `npm install`/`yarn`/`pnpm` directly.
- Run a project-local binary: `hutch pm exec -- <command>` (e.g. `hutch pm exec -- vite build`).
- After changing anything in `src/mainview/`, HMR picks it up; main-process changes need the watch restart.

## Architecture rules (debrid app specifics)

1. **All privileged work lives in the main process** (`src/bun/`): debrid API calls, API keys, filesystem writes, download progress tracking. The webview is UI only.
2. **API keys never reach the webview.** Store them in a main-process config file (e.g. via Cottontail `fs` in the app data dir). The view requests actions by name; the main process attaches credentials.
3. **Debrid HTTP calls** happen in the main process using `fetch` (Cottontail provides it). One provider module per service under `src/bun/debrid/` — keep a shared interface for `addMagnet / checkStatus / listFiles / unrestrict / downloadUrl`.
4. **Downloading files to disk** also happens in the main process (stream `fetch` response → `fs.createWriteStream` or equivalent). The webview never touches the filesystem.
5. **Progress updates flow main → view** via RPC messages (see below), not polling from the view where avoidable.

## RPC: how the view talks to the main process

Define one shared schema, then create both sides. Simplified but accurate shape (verify against `.hutch/devkit/api/shared/rpc.ts`):

```ts
// src/shared/rpc-schema.ts (import from both sides)
import type { ElectrobunRPCSchema } from "electrobun";

export const rpcSchema = {
  bun: { requests: {}, messages: { downloadProgress: { id: string; pct: number } } },
  webview: { requests: { addMagnet: { params: { magnet: string }; response: { id: string } } }, messages: {} },
} satisfies ElectrobunRPCSchema;
```

```ts
// Main process (src/bun/index.ts)
const rpc = defineElectrobunRPC("bun", {
  handlers: {
    requests: {
      addMagnet: ({ magnet }) => debrid.addMagnet(magnet), // params shape per schema
    },
    messages: {}, // handles messages the webview sends (usually none)
  },
});

new BrowserWindow({ title: "...", url, rpc }); // pass rpc in window options
```

```tsx
// Webview (src/mainview/main.tsx or a client module)
import { Electroview, defineElectrobunRPC } from "electrobun/view";

const rpc = defineElectrobunRPC("webview", {
  handlers: { requests: {}, messages: {} },
});
new Electroview({ rpc });

// anywhere in React:
await rpc.request.addMagnet({ magnet });           // typed request → main
rpc.message.downloadProgress({ id, pct: 50 });     // fire-and-forget message → main
// main → view messages arrive via the main-side message handlers
```

Notes:
- Requests are promise-based with an optional `maxRequestTime` timeout.
- Messages are one-way (no response). Use requests for "do X and give me a result", messages for events/progress pushes.
- Create the `Electroview` once at startup (in/near `main.tsx`), not per component.

## Views and asset bundling

- The webview loads `views://mainview/index.html` (or `http://localhost:5173` when the Vite dev server is running in dev).
- The copy map in `electrobun.config.ts` (`dist/index.html` → `views/mainview/index.html`, `dist/assets` → `views/mainview/assets`) is how Vite's output gets into the bundle. If you change Vite's `outDir`/asset structure or add another view, update this map.
- `watchIgnore: ["dist/**"]` exists because HMR handles view rebuilds — keep it.

## UI: React + Tailwind v4 + shadcn/ui

- Tailwind is **v4** via the `@tailwindcss/vite` plugin in `vite.config.ts`. There is no `tailwind.config.js` or `postcss.config.js` — v4 needs neither. Theme/custom tokens live in CSS (`src/mainview/index.css`).
- shadcn/ui is initialized (`components.json`, style `base-nova`, neutral base color, CSS variables, lucide icons, `@base-ui/react` primitives — NOT Radix).
- Path alias `@/*` → `src/mainview/*` is wired in both `tsconfig.json` and `vite.config.ts`.
- **Adding components:** `npx shadcn@latest add <component>` (e.g. `add dialog input table progress`), then run `hutch install` to sync the hutch lockfile (the shadcn CLI installs via npm and leaves a stray `package-lock.json` — delete it).
- `src/mainview/index.css` contains a hand-maintained `@theme inline` block mapping the `--background`/`--primary`/... CSS vars to Tailwind color utilities (`bg-primary`, `border-border`, ...). If a new component uses a token not in that block, add the mapping there.
- Dark mode: `.dark` class on `<html>` (vars are defined for `:root` and `.dark` in `index.css`).
- React 18, `react-jsx` transform, strict TS (`noUnusedLocals`, `noUnusedParameters`, `strict`).
- Styling is Tailwind utility classes; use existing shadcn components (`Button`, `Dialog`, `Input`, `Table`, `Progress`, ...) instead of hand-rolling widgets.

## Routing (wouter)

- **wouter** with **hash-based history** (`useHashLocation`) — required because the webview loads from the `views://` custom scheme where path-based routes break. Always route through the `<Router hook={useHashLocation}>` in `App.tsx`.
- Pages live in `src/mainview/pages/` (downloads, settings). Downloads is the default route (`/`). Add a page: create the component, add a `Route` in `App.tsx`'s `Switch`, add a tab to `NAV_ITEMS` in `App.tsx`. Use `Link` for navigation; unknown paths fall through to Downloads.
- Layout is desktop-style, NOT web-style: full-width tab bar at the top (border-b, underline indicator), breadcrumb strip (8px) below it, flat content sections with `Separator` — avoid card-wrapped forms and web hero patterns.

## Base UI gotchas (learned the hard way)

- shadcn `Button` does NOT forward refs. Never use it as the `render` of a Base UI trigger (`DropdownMenuTrigger`, `DialogTrigger`, `SelectTrigger`, ...) — the popup needs to anchor to the trigger element and the ref silently fails. Instead style the trigger itself: `<DropdownMenuTrigger className={cn(buttonVariants(), "...")}>`.
- `onValueChange` on `Select`/`Tabs` receives `string | null` — handle null explicitly.
- `ProgressValue` render prop is `(formattedValue: string | null, value: number | null)`, not a props object.

## Testing your changes

There is no test runner configured. The check is: `hutch run dev:hmr` boots, the window renders, and RPC round-trips work. For pure logic (parsing magnets, computing paths), prefer small pure functions in the main process so they can be verified independently.

## Common mistakes to avoid

- Importing `electrobun/main` from webview code (or `electrobun/view` from main-process code) — the aliases in `vite.config.ts` (`electrobunViteAliases`) keep these separate; respect the boundary.
- Using `window.__electrobun*` internals directly — they are private; use the public RPC API.
- Adding npm deps without `hutch install` → lockfile drift. The shadcn CLI (`npx shadcn@latest ...`) installs with npm — always delete the stray `package-lock.json` and run `hutch install` after using it.
- Putting debrid API keys or download URLs with embedded tokens into webview state longer than needed — keep them in the main process.
- Editing `.hutch/devkit` to "fix" a type error — regenerate/sync instead (`hutch electrobun prepare`).
