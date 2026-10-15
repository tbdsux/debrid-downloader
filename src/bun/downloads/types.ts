// Main-process job model. The public projection (JobPublic) drops links,
// URLs and source data so nothing token-bearing reaches the webview.
import type { FileTaskPublic, JobKind, ProviderId, RemoteState } from "../../shared/rpc-schema";

/** Pipeline stage; "files" means local transfers own the status. */
export type JobStage = "queued" | "submitting" | "remote" | "resolving" | "files" | "failed";

export type FileTask = FileTaskPublic & {
	/** Remote file key (provider file id / index) */
	key: string;
	/** Hoster link to unrestrict, or a direct URL when `direct` */
	link: string;
	direct: boolean;
	/** PM cloud item id — resolved with getItemDetails */
	itemId?: string;
	/** Path relative to the job folder */
	relPath: string;
	/** Absolute target path, fixed when the task first starts */
	finalPath?: string;
	/** Cached unrestricted URL (memory only, never persisted) */
	url?: string;
};

export type Job = {
	id: string;
	kind: JobKind;
	name: string;
	accountId: string;
	provider: ProviderId;
	stage: JobStage;
	paused: boolean;
	error?: string;
	/** Base download folder chosen when added */
	dir: string;
	/** Folder files land in (dir or dir/<name>) once resolved */
	targetDir?: string;
	addedAt: string;
	completedAt?: string;
	remote?: RemoteState;
	/** Debrid torrent / transfer id */
	torrentId?: string;
	/** magnet URI, hoster link, or path of a saved .torrent */
	source?: string;
	/** Cloud jobs: only these file keys */
	fileKeys?: string[];
	tasks: FileTask[];
	/** Remote poll bookkeeping */
	lastRemoteChange?: number;
};
