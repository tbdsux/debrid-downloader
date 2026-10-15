// Single source of truth for view <-> main RPC. Imported by BOTH sides
// (src/bun/index.ts and src/mainview/lib/rpc.ts). Types only + constants —
// safe for the browser bundle.
//
// Shape per .hutch/devkit/api/shared/rpc.ts:
//   bun    = what the MAIN process handles (requests in)
//   webview= what the VIEW handles (main → view pushes are webview.messages)
// On each side, outgoing calls are typed from the OTHER side's schema.
import type { ElectrobunRPCSchema } from "electrobun";
import type { ProviderId } from "./ids";

export * from "./ids";

// ---------------------------------------------------------------- settings

export type ConflictMode = "rename" | "overwrite" | "skip";
export type ThemeMode = "system" | "light" | "dark";

export type DownloadsSettings = {
	/** Target directory for completed files (absolute). */
	dir: string;
	/** Max simultaneous file transfers, clamped to 1..8. */
	concurrent: number;
	/** KiB/s across all transfers, 0 = unlimited. */
	speedLimit: number;
	/** Put multi-file torrents in a subfolder named after the torrent. */
	subfolder: boolean;
	conflict: ConflictMode;
	/** Automatic retries per file before it's marked failed. */
	retries: number;
};

export type GeneralSettings = {
	theme: ThemeMode;
	/** Offer to add magnets/links found on the clipboard. */
	clipboard: boolean;
	/** OS notification when a job completes. */
	notify: boolean;
	/** Remove the torrent from the debrid account after a successful download. */
	deleteAfter: boolean;
	/** Remote status poll interval in seconds (5..60). */
	pollSeconds: number;
};

export type AdvancedSettings = {
	/** Debrid API request timeout in seconds. */
	timeoutSec: number;
};

export type AccountStatus = "ok" | "invalid" | "unknown";

/** Account as seen by the webview — never carries a usable secret. */
export type AccountPublic = {
	id: string;
	provider: ProviderId;
	label: string;
	auth: "apikey" | "oauth";
	/** Last 4 characters of the key/token, for recognition only. */
	hint: string;
	username?: string;
	premium?: boolean;
	/** ISO date, null = no expiry/free */
	expiresAt?: string | null;
	status: AccountStatus;
	lastError?: string;
	addedAt: string;
	isDefault: boolean;
};

export type PublicSettings = {
	/** In priority order (Auto fallback order). */
	accounts: AccountPublic[];
	defaultAccountId: string | null;
	downloads: DownloadsSettings;
	general: GeneralSettings;
	advanced: AdvancedSettings;
	/** Where settings.json lives (for "Open config folder"). */
	configDir: string;
};

export const MIN_CONCURRENT = 1;
export const MAX_CONCURRENT = 8;

export function clampConcurrent(n: number): number {
	if (!Number.isFinite(n)) return MIN_CONCURRENT;
	return Math.min(MAX_CONCURRENT, Math.max(MIN_CONCURRENT, Math.round(n)));
}

export function clampInt(n: unknown, min: number, max: number, fallback: number): number {
	const v = Number(n);
	if (!Number.isFinite(v)) return fallback;
	return Math.min(max, Math.max(min, Math.round(v)));
}

// ---------------------------------------------------------------- downloads

export type JobKind = "magnet" | "torrent" | "link" | "cloud";

export type JobStatus =
	| "queued" // waiting to be submitted to the debrid service
	| "submitting"
	| "remote" // debrid service is downloading (uncached)
	| "resolving" // fetching file list / links
	| "downloading" // ≥1 file queued or transferring locally
	| "paused"
	| "completed"
	| "failed";

export type TaskStatus = "queued" | "active" | "paused" | "completed" | "failed";

export type FileTaskPublic = {
	id: string;
	name: string;
	/** 0 = unknown */
	bytesTotal: number;
	bytesDone: number;
	/** bytes/s, 0 when idle */
	speed: number;
	status: TaskStatus;
	error?: string;
	/** false once the server ignored a Range request (pause restarts the file). */
	resumable: boolean;
	retries: number;
};

export type RemoteState = {
	/** debrid-ts TorrentStatus */
	status: string;
	/** 0..100 */
	progress: number;
	speed?: number;
	seeders?: number;
};

export type JobPublic = {
	id: string;
	kind: JobKind;
	name: string;
	accountId: string;
	provider: ProviderId;
	status: JobStatus;
	remote?: RemoteState;
	error?: string;
	dir: string;
	addedAt: string;
	completedAt?: string;
	tasks: FileTaskPublic[];
	bytesTotal: number;
	bytesDone: number;
	speed: number;
};

export type AddJobsInput = {
	kind: "magnet" | "link";
	inputs: string[];
	/** account id or "auto" */
	accountId: string;
	dir?: string;
	start?: boolean;
};

export type JobAction =
	| "pause"
	| "resume"
	| "retry"
	| "remove"
	| "removeAndDelete"
	| "removeFromDebrid";

export type DownloadStats = {
	freeBytes: number | null;
};

// ---------------------------------------------------------------- cloud

export type CloudTorrent = {
	id: string;
	name: string;
	status: string;
	progress: number;
	bytes: number;
	addedAt?: string;
	speed?: number;
	seeders?: number;
};

export type CloudFile = {
	id: string;
	path: string;
	bytes: number;
};

export type CloudLink = {
	id: string;
	filename: string;
	bytes: number;
	host?: string;
	/** Original hoster link (not a secret; unrestricted again on download). */
	link: string;
	addedAt?: string;
};

export type CloudFolder = {
	id: string | null;
	name: string;
	breadcrumbs: { id: string | null; name: string }[];
	folders: { id: string; name: string }[];
	files: { id: string; name: string; bytes: number; addedAt?: string }[];
};

export type CloudAccountInfo = {
	username: string;
	premium: boolean;
	expiresAt: string | null;
};

// ---------------------------------------------------------------- auth flow

export type AuthFlowStart = {
	flowId: string;
	userCode: string;
	verifyUrl: string;
	expiresIn: number;
};

export type AuthFlowResult = {
	flowId: string;
	ok: boolean;
	account?: AccountPublic;
	error?: string;
};

// ---------------------------------------------------------------- schema

export interface AppRpcSchema extends ElectrobunRPCSchema {
	bun: {
		requests: {
			// settings
			getSettings: { params: undefined; response: PublicSettings };
			saveDownloadOpts: { params: Partial<DownloadsSettings>; response: PublicSettings };
			saveGeneral: { params: Partial<GeneralSettings>; response: PublicSettings };
			saveAdvanced: { params: Partial<AdvancedSettings>; response: PublicSettings };
			resetSettings: { params: undefined; response: PublicSettings };
			pickFolder: { params: { startingFolder?: string }; response: string | null };
			openConfigFolder: { params: undefined; response: void };
			openExternal: { params: { url: string }; response: boolean };
			readClipboardCandidate: { params: undefined; response: string | null };
			// accounts
			addAccountWithKey: {
				params: { provider: ProviderId; label: string; apiKey: string };
				response: PublicSettings;
			};
			startAuthFlow: {
				params: { provider: ProviderId; label: string };
				response: AuthFlowStart;
			};
			cancelAuthFlow: { params: { flowId: string }; response: void };
			updateAccount: {
				params: { id: string; label?: string; isDefault?: boolean; apiKey?: string };
				response: PublicSettings;
			};
			reorderAccounts: { params: { ids: string[] }; response: PublicSettings };
			removeAccount: { params: { id: string }; response: PublicSettings };
			refreshAccount: { params: { id: string }; response: PublicSettings };
			// downloads
			listJobs: { params: undefined; response: JobPublic[] };
			addJobs: { params: AddJobsInput; response: JobPublic[] };
			addTorrentFiles: {
				params: {
					files: { name: string; base64: string }[];
					accountId: string;
					dir?: string;
					start?: boolean;
				};
				response: JobPublic[];
			};
			pickTorrentFiles: {
				params: undefined;
				response: { name: string; base64: string }[];
			};
			jobAction: { params: { ids: string[]; action: JobAction }; response: void };
			taskAction: {
				params: { jobId: string; taskIds: string[]; action: "pause" | "resume" | "retry" };
				response: void;
			};
			clearCompleted: { params: undefined; response: void };
			openPath: {
				params: { jobId: string; taskId?: string; reveal?: boolean };
				response: void;
			};
			copyLink: { params: { jobId: string; taskId?: string }; response: boolean };
			downloadStats: { params: undefined; response: DownloadStats };
			// cloud
			cloudAccountInfo: { params: { accountId: string }; response: CloudAccountInfo };
			cloudTorrents: {
				params: { accountId: string; offset: number; limit: number };
				response: { items: CloudTorrent[]; hasMore: boolean };
			};
			cloudTorrentFiles: {
				params: { accountId: string; id: string };
				response: CloudFile[];
			};
			cloudHistory: {
				params: { accountId: string; offset: number; limit: number };
				response: { items: CloudLink[]; hasMore: boolean };
			};
			cloudFolder: {
				params: { accountId: string; folderId?: string | null };
				response: CloudFolder;
			};
			cloudDownload: {
				params: {
					accountId: string;
					torrentId: string;
					name: string;
					fileIds?: string[];
					dir?: string;
				};
				response: JobPublic[];
			};
			cloudDownloadItems: {
				params: {
					accountId: string;
					items: { id: string; name: string; bytes: number }[];
					dir?: string;
				};
				response: JobPublic[];
			};
			cloudDelete: {
				params: { accountId: string; torrentIds: string[] };
				response: void;
			};
		};
		messages: {};
	};
	webview: {
		requests: {};
		messages: {
			jobsChanged: { upserts: JobPublic[]; removed: string[] };
			authFlowResult: AuthFlowResult;
			settingsChanged: PublicSettings;
			notify: { kind: "success" | "error" | "info"; title: string; description?: string };
		};
	};
}
