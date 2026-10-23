import "./net-tuning"; // must run before any network call
import Electrobun, { BrowserWindow, Updater, Utils, defineElectrobunRPC } from "electrobun/main";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { loadSettings, onSettingsChanged, resetPreferences, toPublic, updateSettings } from "./settings";
import * as accounts from "./accounts/store";
import { cancelAuthFlow, startAuthFlow } from "./accounts/auth-flows";
import { DownloadManager } from "./downloads/manager";
import * as cloud from "./cloud";
import { clipboardCandidate, splitLines } from "./debrid/magnet";
import type { AppRpcSchema, JobPublic } from "../shared/rpc-schema";

// Privileged side of the app: owns settings, account secrets, the download
// engine and all debrid HTTP. The webview requests actions by name and gets
// pushes (jobsChanged, settingsChanged, …) — never secrets or signed URLs.

// ---------------------------------------------------------------- pushes

const dirtyJobs = new Set<string>();
const removedJobs = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;

/** Batch job updates: at most ~4 pushes/s, diffs only. */
function queueJobPush() {
	if (flushTimer) return;
	flushTimer = setTimeout(() => {
		flushTimer = undefined;
		const upserts: JobPublic[] = [];
		for (const id of dirtyJobs) {
			const j = manager.get(id);
			if (j) upserts.push(j);
		}
		const removed = [...removedJobs];
		dirtyJobs.clear();
		removedJobs.clear();
		if (upserts.length || removed.length) rpc.send.jobsChanged({ upserts, removed });
	}, 250);
}

const manager = new DownloadManager({
	changed: (id) => {
		dirtyJobs.add(id);
		queueJobPush();
	},
	removed: (id) => {
		dirtyJobs.delete(id);
		removedJobs.add(id);
		queueJobPush();
	},
	toast: (kind, title, description) => rpc.send.notify({ kind, title, description }),
});

onSettingsChanged((s) => {
	manager.applySettings(s);
	rpc.send.settingsChanged(toPublic(s));
});

const pub = async () => toPublic(await loadSettings());

// ---------------------------------------------------------------- rpc

const rpc = defineElectrobunRPC<AppRpcSchema, "bun">("bun", {
	maxRequestTime: 30_000,
	handlers: {
		requests: {
			// settings
			getSettings: pub,
			saveDownloadOpts: async (patch) =>
				toPublic(await updateSettings((s) => Object.assign(s.downloads, patch))),
			saveGeneral: async (patch) =>
				toPublic(await updateSettings((s) => Object.assign(s.general, patch))),
			saveAdvanced: async (patch) =>
				toPublic(await updateSettings((s) => Object.assign(s.advanced, patch))),
			resetSettings: async () => toPublic(await resetPreferences()),
			pickFolder: async ({ startingFolder }) => {
				const picked = await Utils.openFileDialog({
					startingFolder: startingFolder || Utils.paths.downloads,
					canChooseFiles: false,
					canChooseDirectory: true,
					allowsMultipleSelection: false,
				});
				return picked.find((p) => p.trim() !== "") ?? null;
			},
			openConfigFolder: async () => {
				Utils.openPath((await pub()).configDir);
			},
			openExternal: async ({ url }) => {
				// Only web links — never file:// or app schemes from the view.
				if (!/^https?:\/\//i.test(url)) return false;
				return Utils.openExternal(url);
			},
			readClipboardCandidate: async () => {
				try {
					return clipboardCandidate(Utils.clipboardReadText());
				} catch {
					return null;
				}
			},

			// accounts
			addAccountWithKey: async ({ provider, label, apiKey }) =>
				toPublic(await accounts.addAccountWithKey(provider, label, apiKey)),
			startAuthFlow: ({ provider, label }) =>
				startAuthFlow(provider, label, (r) => {
					const account = r.state?.accounts.find((a) => a.id === r.accountId);
					rpc.send.authFlowResult({
						flowId: r.flowId,
						ok: r.ok,
						error: r.error,
						account: account && { ...account, isDefault: r.state!.defaultAccountId === account.id },
					});
				}),
			cancelAuthFlow: async ({ flowId }) => cancelAuthFlow(flowId),
			updateAccount: async (p) => toPublic(await accounts.updateAccount(p)),
			reorderAccounts: async ({ ids }) => toPublic(await accounts.reorderAccounts(ids)),
			removeAccount: async ({ id }) => toPublic(await accounts.removeAccount(id)),
			refreshAccount: async ({ id }) => toPublic(await accounts.refreshAccount(id)),

			// downloads
			listJobs: async () => manager.list(),
			addJobs: async ({ kind, inputs, accountId, dir, start }) => {
				const lines = inputs.flatMap(splitLines);
				return kind === "magnet"
					? manager.addMagnets(lines, accountId, dir, start)
					: manager.addLinks(lines, accountId, dir, start);
			},
			addTorrentFiles: ({ files, accountId, dir, start }) =>
				manager.addTorrentFiles(files, accountId, dir, start),
			pickTorrentFiles: async () => {
				const paths = await Utils.openFileDialog({
					startingFolder: Utils.paths.downloads,
					allowedFileTypes: "torrent",
					canChooseFiles: true,
					canChooseDirectory: false,
					allowsMultipleSelection: true,
				});
				return paths
					.filter((p) => p.trim() !== "")
					.map((p) => ({ name: basename(p), base64: readFileSync(p).toString("base64") }));
			},
			jobAction: ({ ids, action }) => manager.jobAction(ids, action),
			taskAction: async ({ jobId, taskIds, action }) => manager.taskAction(jobId, taskIds, action),
			clearCompleted: () => manager.clearCompleted(),
			openPath: async ({ jobId, taskId, reveal }) => manager.openPath(jobId, taskId, reveal),
			copyLink: ({ jobId, taskId }) => manager.copyLink(jobId, taskId),
			downloadStats: async () => ({ freeBytes: manager.freeBytes() }),

			// cloud
			cloudAccountInfo: ({ accountId }) => cloud.accountInfo(accountId),
			cloudTorrents: ({ accountId, offset, limit }) => cloud.torrents(accountId, offset, limit),
			cloudTorrentFiles: ({ accountId, id }) => cloud.torrentFiles(accountId, id),
			cloudHistory: ({ accountId, offset, limit }) => cloud.history(accountId, offset, limit),
			cloudFolder: ({ accountId, folderId }) => cloud.folder(accountId, folderId ?? null),
			cloudDownload: ({ accountId, torrentId, name, fileIds, dir }) =>
				manager.addCloudTorrent(accountId, torrentId, name, fileIds, dir),
			cloudDownloadItems: ({ accountId, items, dir }) => manager.addCloudItems(accountId, items, dir),
			cloudDelete: ({ accountId, torrentIds }) => cloud.remove(accountId, torrentIds),
			applyUpdate: async () => {
				manager.flush();
				await Updater.applyUpdate();
			},
		},
		messages: {},
	},
});

// ---------------------------------------------------------------- window

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

// Check if Vite dev server is running for HMR
async function getMainViewUrl(): Promise<string> {
	const channel = await Updater.localInfo.channel();
	if (channel === "dev") {
		try {
			await fetch(DEV_SERVER_URL, { method: "HEAD" });
			console.log(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`);
			return DEV_SERVER_URL;
		} catch {
			console.log("Vite dev server not running. Run 'hutch run dev:hmr' for HMR support.");
		}
	}
	return "views://mainview/index.html";
}

await manager.init();
Electrobun.events.on("before-quit", () => manager.flush());

const url = await getMainViewUrl();

void new BrowserWindow({
	title: "Debrid Downloader",
	// macOS: the app header doubles as the title bar (traffic lights inset over it).
	titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
	url,
	frame: {
		width: 1100,
		height: 720,
		x: 160,
		y: 120,
	},
	rpc,
});

// Background update: check once on launch, download silently, then let the user pick when to restart.
async function checkForUpdate() {
	if ((await Updater.localInfo.channel()) === "dev") return;
	const info = await Updater.checkForUpdate();
	if (info.error) return console.error(`[update] ${info.error}`);
	if (!info.updateAvailable) return;
	if (!info.updateReady) await Updater.downloadUpdate();
	if (Updater.updateInfo().updateReady) rpc.send.updateReady({ version: info.version });
	else console.error(`[update] download failed: ${Updater.updateInfo().error}`);
}
void checkForUpdate().catch((e) => console.error("[update]", e));
