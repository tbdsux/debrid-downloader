import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "Debrid Downloader",
		identifier: "com.werklabs.debriddownloader",
		// Keep in sync with package.json "version".
		version: "0.1.1",
	},
	build: {
		mainProcess: "cottontail",
		cottontail: {
			entrypoint: "src/bun/index.ts",
		},
		// Vite builds to dist/, we copy from there
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets": "views/mainview/assets",
		},
		// Ignore Vite output in watch mode — HMR handles view rebuilds separately
		watchIgnore: ["dist/**"],
		mac: {
			icons: "assets/icon.iconset",
			// Signing/notarizing turns on only when the Apple credentials are exported (see README).
			codesign: !!process.env.ELECTROBUN_DEVELOPER_ID,
			notarize: !!process.env.ELECTROBUN_APPLEIDPASS,
			bundleCEF: false,
		},
		linux: {
			icon: "assets/icon.iconset/icon_256x256.png",
			bundleCEF: false,
		},
		win: {
			icon: "assets/icon.iconset/icon_256x256.png",
			bundleCEF: false,
		},
	},
	release: {
		// The updater fetches <baseUrl>/<channel>-<os>-<arch>-update.json; CI attaches those files to each GitHub release.
		baseUrl: "https://github.com/tbdsux/debrid-downloader/releases/latest/download",
		// shortcut: full downloads only (no bsdiff patches), patches need the previous release's files at build time; enable once releases are regular.
		generatePatch: false,
	},
} satisfies ElectrobunConfig;
