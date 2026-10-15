import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "Debrid Downloader",
		identifier: "com.werklabs.debriddownloader",
		// Keep in sync with package.json "version".
		version: "0.1.0",
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
} satisfies ElectrobunConfig;
