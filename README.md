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

## Installing

Download the file for your platform from the [latest release](https://github.com/tbdsux/debrid-downloader/releases/latest), or use the commands below. The app updates itself after that: at launch it downloads a newer release in the background and offers a restart.

| Platform                  | File                                      | Notes                                  |
| ------------------------- | ----------------------------------------- | -------------------------------------- |
| macOS 14+ (Apple Silicon) | `macos-arm64-DebridDownloader.dmg`        | not signed, see below                  |
| Windows 10/11 (x64)       | `win-x64-DebridDownloader-Setup.zip`      | contains `Debrid Downloader-Setup.exe` |
| Linux (x64)               | `linux-x64-DebridDownloader-Setup.tar.gz` | contains an `installer` program        |

The other files in a release (`*.tar.zst`, `*-update.json`) are for the auto-updater; you don't need them.

### macOS

```bash
curl -fLO https://github.com/tbdsux/debrid-downloader/releases/latest/download/macos-arm64-DebridDownloader.dmg
hdiutil attach macos-arm64-DebridDownloader.dmg -nobrowse -mountpoint /Volumes/DebridDownloader
cp -R "/Volumes/DebridDownloader/Debrid Downloader.app" /Applications/
hdiutil detach /Volumes/DebridDownloader
xattr -cr "/Applications/Debrid Downloader.app"   # unsigned build, see warning
open "/Applications/Debrid Downloader.app"
```

> [!WARNING]
> **macOS builds are not signed or notarized.** Without the `xattr -cr` step, macOS blocks the app on first launch with "Debrid Downloader is damaged and can't be opened" or "cannot verify the developer". Run it once you trust the download.

### Windows (PowerShell)

```powershell
Invoke-WebRequest https://github.com/tbdsux/debrid-downloader/releases/latest/download/win-x64-DebridDownloader-Setup.zip -OutFile DebridDownloader-Setup.zip
Expand-Archive DebridDownloader-Setup.zip -DestinationPath DebridDownloader-Setup
& ".\DebridDownloader-Setup\Debrid Downloader-Setup.exe"
```

The setup program is not signed either: if SmartScreen shows "Windows protected your PC", click **More info → Run anyway**. It installs for your user only (no admin prompt) and adds a Start menu shortcut.

### Linux

The app uses the system WebKitGTK, so install it first:

```bash
sudo apt install libgtk-3-0 libwebkit2gtk-4.1-0     # Debian / Ubuntu 22.04+
sudo dnf install gtk3 webkit2gtk4.1                 # Fedora
sudo pacman -S gtk3 webkit2gtk-4.1                  # Arch
```

Then download and run the installer:

```bash
curl -fLO https://github.com/tbdsux/debrid-downloader/releases/latest/download/linux-x64-DebridDownloader-Setup.tar.gz
mkdir -p DebridDownloader-Setup
tar -xzf linux-x64-DebridDownloader-Setup.tar.gz -C DebridDownloader-Setup
./DebridDownloader-Setup/installer
```

It installs into `~/.local/share/com.werklabs.debriddownloader/` and adds an app-menu entry. No root needed.

### Uninstalling

| Platform | How                                                                             |
| -------- | ------------------------------------------------------------------------------- |
| macOS    | `~/Library/Application\ Support/com.werklabs.debriddownloader/stable/uninstall` |
| Windows  | **Settings → Apps → Installed apps → Debrid Downloader → Uninstall**            |
| Linux    | `~/.local/share/com.werklabs.debriddownloader/stable/uninstall`                 |

The uninstaller asks whether to keep your settings and accounts. Add `--quiet` to skip the prompt (keeps data) or `--quiet --delete-data` to remove everything.

## Requirements

- [Hutch](https://framework.blackboard.sh/electrobun/guides/hutch/), the toolchain that installs dependencies and runs Electrobun
- macOS: Xcode Command Line Tools (`xcode-select --install`), needed to build the app icon

## Development

```bash
hutch run install    # install dependencies from the lockfile
hutch run dev:hmr    # run the app with Vite hot reload (recommended)
hutch run dev        # run the app from bundled assets, no hot reload
bun test             # unit tests for main-process logic (src/bun/**/*.test.ts)
hutch run lint       # oxlint (hutch run lint:fix to apply safe fixes)
hutch run fmt        # format with oxfmt (CI runs hutch run fmt:check)
```

To add a dependency, edit `package.json` and run `hutch install`. Don't use `npm`, `yarn` or `pnpm`.

## Building

```bash
hutch run build:canary   # canary channel
hutch run build          # stable channel
```

The output goes to `artifacts/`:

| File                                                               | Purpose                                                         |
| ------------------------------------------------------------------ | --------------------------------------------------------------- |
| `*.dmg` (macOS), `*-Setup.zip` (Windows), `*-Setup.tar.gz` (Linux) | installers to hand out to users (see [Installing](#installing)) |
| `*.tar.zst`                                                        | compressed app, used by the auto-updater                        |
| `*-update.json`                                                    | update manifest for the channel                                 |

Each OS builds on itself, so `artifacts/` only has your own platform's files; CI builds all three. The auto-updater reads `release.baseUrl` in `electrobun.config.ts` (GitHub's `releases/latest/download`).

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
