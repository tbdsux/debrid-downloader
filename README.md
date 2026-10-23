# Debrid Downloader

A desktop app that downloads torrents, magnet links and hoster links through debrid services and saves the files locally.

Supported services: **Real-Debrid**, **AllDebrid**, **Premiumize**.

Built with [Electrobun](https://framework.blackboard.sh/electrobun/) (not Electron), React 18, Tailwind CSS v4 and shadcn/ui.

## Features

- Add magnets, `.torrent` files and direct/hoster links (Cmd/Ctrl+N)
- Multiple debrid accounts, signed in with an API key or a device code
- Browse the torrents, files and history already on your debrid account (Cloud tab)
- Parallel downloads with progress, speed limit and resume
- API keys stay in the main process, encrypted at rest, and never reach the UI

## Requirements

- [Hutch](https://framework.blackboard.sh/electrobun/guides/hutch/), the toolchain that installs dependencies and runs Electrobun
- macOS: Xcode Command Line Tools (`xcode-select --install`), needed to build the app icon

## Development

```bash
hutch run install    # install dependencies from the lockfile
hutch run dev:hmr    # run the app with Vite hot reload (recommended)
hutch run dev        # run the app from bundled assets, no hot reload
bun test             # unit tests for main-process logic (src/bun/**/*.test.ts)
```

To add a dependency, edit `package.json` and run `hutch install`. Don't use `npm`, `yarn` or `pnpm`.

## Building

```bash
hutch run build:canary   # canary channel
hutch run build          # stable channel
```

The output goes to `artifacts/`:

| File | Purpose |
|---|---|
| `*.dmg` | macOS installer to hand out to users |
| `*.app.tar.zst` | compressed app, used by the auto-updater |
| `*-update.json` | update manifest for the channel |

Installed apps check `releases/latest/download` on GitHub at launch, download a newer stable build in the background, and offer a restart to finish updating.

> [!WARNING]
> **macOS builds are not signed or notarized.** macOS blocks the app on first launch with "Debrid Downloader is damaged and can't be opened" or "cannot verify the developer". Once you trust the download, clear the quarantine flag:
>
> ```bash
> xattr -cr "/Applications/Debrid Downloader.app"
> ```

### CI

`.github/workflows/ci.yml` runs the unit tests on every push and pull request. `.github/workflows/release.yml` builds macOS, Linux and Windows: a manual run ("Run workflow" in the Actions tab) builds the canary channel as workflow artifacts.

## App icon

The icons live in `assets/icon.iconset/` (macOS iconset naming, `icon_16x16.png` to `icon_512x512.png`). Windows and Linux use `icon_256x256.png` from the same folder. To change the icon, replace the PNGs and keep the file names.

## Project layout

```
src/
  bun/          main process: debrid APIs, accounts, downloads, settings
  mainview/     webview UI (React, wouter hash routes: Downloads, Cloud, Settings)
  shared/       RPC schema and types shared by both sides
assets/         app icon
electrobun.config.ts   app name, identifier, version, build/icon/signing settings
hutch.config.ts        scripts and pinned Electrobun version
```

Contributors (human or AI): read [AGENTS.md](AGENTS.md) for the architecture rules before making changes.

## License

[MIT](LICENSE)
