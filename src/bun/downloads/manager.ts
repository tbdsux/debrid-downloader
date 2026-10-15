// Download job state machine.
//
//   queued ─▶ submitting ─▶ remote ─▶ resolving ─▶ files ─▶ (completed)
//                  │           │           │         └─ per-file tasks in p-queue
//                  └───────────┴───────────┴──▶ failed
//
// - submitting: add magnet / torrent / unrestrict link on the account
// - remote:     the debrid service is fetching it (uncached); polled per account
// - resolving:  list the finished torrent's files → one FileTask each
// - files:      local transfers; the job's public status derives from its tasks
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, statfsSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import PQueue from "p-queue";
import { Utils } from "electrobun/main";
import type { Torrent } from "debrid-ts";
import * as adapter from "../debrid/adapter";
import { errorMessage, withClient } from "../accounts/clients";
import { resolveAccountId } from "../accounts/store";
import { loadSettings, newId, type SettingsState } from "../settings";
import { nameFromUrl, parseMagnet, safeFileName } from "../debrid/magnet";
import { torrentsDir } from "../paths";
import { RateLimiter, SpeedMeter } from "./progress";
import { HttpError, transfer } from "./transfer";
import { flushSave, loadJobs, scheduleSave } from "./store";
import type { FileTask, Job } from "./types";
import type {
	DownloadsSettings,
	GeneralSettings,
	JobAction,
	JobPublic,
	JobStatus,
	RemoteState,
} from "../../shared/rpc-schema";

export type ManagerHooks = {
	changed: (jobId: string) => void;
	removed: (jobId: string) => void;
	toast: (kind: "success" | "error" | "info", title: string, description?: string) => void;
};

const SLOW_POLL_AFTER_MS = 10 * 60_000;
const SLOW_POLL_MS = 30_000;

// ---------------------------------------------------------------- projection

export function deriveStatus(job: Job): JobStatus {
	if (job.stage === "failed") return "failed";
	if (job.paused) return "paused";
	if (job.stage !== "files") return job.stage;
	const t = job.tasks;
	if (t.some((x) => x.status === "active" || x.status === "queued")) return "downloading";
	if (t.length > 0 && t.every((x) => x.status === "completed")) return "completed";
	if (t.some((x) => x.status === "paused")) return "paused";
	return t.length ? "failed" : "downloading";
}

export function toPublicJob(job: Job): JobPublic {
	let bytesTotal = 0;
	let bytesDone = 0;
	let speed = 0;
	for (const t of job.tasks) {
		bytesTotal += t.bytesTotal;
		bytesDone += t.bytesDone;
		speed += t.speed;
	}
	const failed = job.tasks.filter((t) => t.status === "failed").length;
	return {
		id: job.id,
		kind: job.kind,
		name: job.name,
		accountId: job.accountId,
		provider: job.provider,
		status: deriveStatus(job),
		remote: job.remote,
		error: job.error ?? (failed ? `${failed} file${failed > 1 ? "s" : ""} failed` : undefined),
		dir: job.targetDir ?? job.dir,
		addedAt: job.addedAt,
		completedAt: job.completedAt,
		tasks: job.tasks.map((t) => ({
			id: t.id,
			name: t.name,
			bytesTotal: t.bytesTotal,
			bytesDone: t.bytesDone,
			speed: t.speed,
			status: t.status,
			error: t.error,
			resumable: t.resumable,
			retries: t.retries,
		})),
		bytesTotal,
		bytesDone,
		speed,
	};
}

function remoteOf(t: Torrent): RemoteState {
	return { status: t.status, progress: t.progress, speed: t.speed, seeders: t.seeders };
}

function partSize(path: string | undefined): number {
	if (!path) return 0;
	try {
		return statSync(path).size;
	} catch {
		return 0;
	}
}

// ---------------------------------------------------------------- manager

export class DownloadManager {
	private jobs = new Map<string, Job>();
	private queue = new PQueue({ concurrency: 3 });
	private controllers = new Map<string, AbortController>();
	private busy = new Set<string>();
	private lastPolled = new Map<string, number>();
	private limiter = new RateLimiter(0);
	private downloads!: DownloadsSettings;
	private general!: GeneralSettings;
	private pollTimer?: ReturnType<typeof setTimeout>;
	private polling = false;

	constructor(private hooks: ManagerHooks) {}

	async init(): Promise<void> {
		this.applySettings(await loadSettings());
		for (const job of loadJobs()) {
			for (const t of job.tasks) {
				t.speed = 0;
				if (t.status === "active") t.status = "queued";
				if (t.status !== "completed") t.bytesDone = partSize(t.finalPath && `${t.finalPath}.part`);
			}
			if (job.stage === "submitting") job.stage = job.torrentId ? "remote" : "queued";
			this.jobs.set(job.id, job);
		}
		for (const job of this.jobs.values()) this.advance(job);
		this.schedulePoll(1000);
	}

	applySettings(s: SettingsState): void {
		this.downloads = s.downloads;
		this.general = s.general;
		this.queue.concurrency = s.downloads.concurrent;
		this.limiter.limit = s.downloads.speedLimit * 1024;
	}

	flush(): void {
		flushSave(() => this.jobs.values());
	}

	list(): JobPublic[] {
		return [...this.jobs.values()].map(toPublicJob);
	}

	get(jobId: string): JobPublic | undefined {
		const j = this.jobs.get(jobId);
		return j && toPublicJob(j);
	}

	private touch(job: Job): void {
		this.hooks.changed(job.id);
		scheduleSave(() => this.jobs.values());
	}

	// ------------------------------------------------------------ adding

	private async baseJob(
		kind: Job["kind"],
		accountId: string,
		name: string,
		dir: string | undefined,
		start: boolean | undefined,
	): Promise<Job> {
		const id = await resolveAccountId(accountId);
		const s = await loadSettings();
		const account = s.accounts.find((a) => a.id === id)!;
		return {
			id: newId("job"),
			kind,
			name,
			accountId: id,
			provider: account.provider,
			stage: "queued",
			paused: start === false,
			dir: dir?.trim() || this.downloads.dir,
			addedAt: new Date().toISOString(),
			tasks: [],
		};
	}

	private register(jobs: Job[]): JobPublic[] {
		for (const j of jobs) {
			this.jobs.set(j.id, j);
			this.touch(j);
			this.advance(j);
		}
		return jobs.map(toPublicJob);
	}

	async addMagnets(inputs: string[], accountId: string, dir?: string, start?: boolean): Promise<JobPublic[]> {
		const jobs: Job[] = [];
		const bad: string[] = [];
		for (const input of inputs) {
			const m = parseMagnet(input);
			if (!m) {
				bad.push(input);
				continue;
			}
			const job = await this.baseJob("magnet", accountId, m.name ?? m.hash, dir, start);
			job.source = m.uri;
			jobs.push(job);
		}
		if (bad.length) {
			this.hooks.toast("error", `${bad.length} line(s) aren't valid magnet links`, bad[0]?.slice(0, 80));
		}
		return this.register(jobs);
	}

	async addLinks(inputs: string[], accountId: string, dir?: string, start?: boolean): Promise<JobPublic[]> {
		const jobs: Job[] = [];
		for (const link of inputs) {
			try {
				new URL(link);
			} catch {
				this.hooks.toast("error", "Not a valid link", link.slice(0, 80));
				continue;
			}
			const job = await this.baseJob("link", accountId, nameFromUrl(link), dir, start);
			job.source = link;
			jobs.push(job);
		}
		return this.register(jobs);
	}

	async addTorrentFiles(
		files: { name: string; base64: string }[],
		accountId: string,
		dir?: string,
		start?: boolean,
	): Promise<JobPublic[]> {
		const jobs: Job[] = [];
		for (const f of files) {
			const job = await this.baseJob("torrent", accountId, f.name.replace(/\.torrent$/i, ""), dir, start);
			const path = join(torrentsDir(), `${job.id}.torrent`);
			writeFileSync(path, Buffer.from(f.base64, "base64"));
			job.source = path;
			jobs.push(job);
		}
		return this.register(jobs);
	}

	/** A torrent already on the account: skip submitting. */
	async addCloudTorrent(
		accountId: string,
		torrentId: string,
		name: string,
		fileKeys?: string[],
		dir?: string,
	): Promise<JobPublic[]> {
		const job = await this.baseJob("cloud", accountId, name, dir, true);
		job.torrentId = torrentId;
		job.fileKeys = fileKeys?.length ? fileKeys : undefined;
		job.stage = "remote";
		const out = this.register([job]);
		this.schedulePoll(200);
		return out;
	}

	/** Premiumize cloud files: tasks resolved via item ids. */
	async addCloudItems(
		accountId: string,
		items: { id: string; name: string; bytes: number }[],
		dir?: string,
	): Promise<JobPublic[]> {
		const jobs: Job[] = [];
		for (const item of items) {
			const job = await this.baseJob("cloud", accountId, item.name, dir, true);
			job.stage = "files";
			job.targetDir = job.dir;
			job.tasks = [this.newTask(item.id, safeFileName(item.name), item.name, item.bytes, "", true, item.id)];
			jobs.push(job);
		}
		return this.register(jobs);
	}

	private newTask(
		key: string,
		relPath: string,
		name: string,
		bytes: number,
		link: string,
		direct: boolean,
		itemId?: string,
	): FileTask {
		return {
			id: newId("t"),
			key,
			name,
			relPath,
			link,
			direct,
			itemId,
			bytesTotal: bytes,
			bytesDone: 0,
			speed: 0,
			status: "queued",
			resumable: true,
			retries: 0,
		};
	}

	// ------------------------------------------------------------ pipeline

	private advance(job: Job): void {
		if (job.paused || this.busy.has(job.id) || !this.jobs.has(job.id)) return;
		switch (job.stage) {
			case "queued":
				void this.submit(job);
				break;
			case "resolving":
				void this.resolve(job);
				break;
			case "remote":
				this.schedulePoll(1500);
				break;
			case "files":
				for (const t of job.tasks) if (t.status === "queued") this.enqueue(job, t);
				break;
		}
	}

	private fail(job: Job, err: unknown, prefix = ""): void {
		job.stage = "failed";
		job.error = prefix + errorMessage(err);
		this.hooks.toast("error", `Failed: ${job.name}`, job.error);
	}

	private async submit(job: Job): Promise<void> {
		this.busy.add(job.id);
		job.stage = "submitting";
		job.error = undefined;
		this.touch(job);
		try {
			await withClient(job.accountId, async (client) => {
				if (job.kind === "magnet") {
					const t = await adapter.addMagnet(client, job.source!);
					job.torrentId = t.id;
					if (t.name) job.name = t.name;
					job.remote = remoteOf(t);
					await adapter.startTorrent(client, t);
					job.stage = "remote";
				} else if (job.kind === "torrent") {
					const bytes = new Uint8Array(readFileSync(job.source!));
					job.torrentId = await adapter.addTorrentFile(client, bytes, basename(job.source!));
					rmSync(job.source!, { force: true });
					job.stage = "remote";
				} else if (job.kind === "link") {
					const files = await adapter.resolveLink(client, job.source!);
					if (!files.length) throw new Error("The service returned no files for this link");
					if (files.length === 1) job.name = files[0]!.path;
					job.targetDir = job.dir;
					job.tasks = files.map((f) => {
						// RD/AD: keep the hoster link so an expired URL can be re-unrestricted;
						// PM links are direct and get re-listed from the source instead.
						const direct = job.provider === "premiumize";
						const t = this.newTask(
							f.key,
							safeFileName(basename(f.path)),
							basename(f.path),
							f.bytes,
							direct ? f.link : job.source!,
							direct,
						);
						t.url = f.link;
						return t;
					});
					job.stage = "files";
				}
			});
		} catch (err) {
			this.fail(job, err);
		} finally {
			this.busy.delete(job.id);
		}
		this.touch(job);
		this.advance(job);
	}

	private async resolve(job: Job): Promise<void> {
		this.busy.add(job.id);
		this.touch(job);
		try {
			let files = await withClient(job.accountId, (c) => adapter.listFiles(c, job.torrentId!));
			if (job.fileKeys) {
				const keep = new Set(job.fileKeys);
				files = files.filter((f) => keep.has(f.key));
			}
			if (!files.length) throw new Error("The torrent has no downloadable files");
			const nested = this.downloads.subfolder && files.length > 1;
			const folder = safeFileName(job.name);
			job.targetDir = nested ? join(job.dir, folder) : job.dir;
			job.tasks = files.map((f) => {
				let parts = f.path.split("/").filter(Boolean).map(safeFileName);
				// Torrents usually wrap files in a folder named like the torrent.
				if (nested && parts.length > 1 && parts[0] === folder) parts = parts.slice(1);
				const rel = nested ? join(...parts) : parts[parts.length - 1]!;
				return this.newTask(f.key, rel, basename(f.path), f.bytes, f.link, f.direct);
			});
			job.stage = "files";
		} catch (err) {
			this.fail(job, err, "Could not list files: ");
		} finally {
			this.busy.delete(job.id);
		}
		this.touch(job);
		this.advance(job);
	}

	// ------------------------------------------------------------ remote poller

	private schedulePoll(delayMs?: number): void {
		const ms = delayMs ?? (this.general?.pollSeconds ?? 5) * 1000;
		if (this.pollTimer) clearTimeout(this.pollTimer);
		this.pollTimer = setTimeout(() => void this.pollRemote(), ms);
	}

	private async pollRemote(): Promise<void> {
		if (this.polling) return;
		this.polling = true;
		try {
			const now = Date.now();
			const byAccount = new Map<string, Job[]>();
			for (const job of this.jobs.values()) {
				if (job.stage !== "remote" || job.paused || !job.torrentId) continue;
				const quiet = now - (job.lastRemoteChange ?? now) > SLOW_POLL_AFTER_MS;
				if (quiet && now - (this.lastPolled.get(job.id) ?? 0) < SLOW_POLL_MS) continue;
				this.lastPolled.set(job.id, now);
				const list = byAccount.get(job.accountId) ?? [];
				list.push(job);
				byAccount.set(job.accountId, list);
			}
			await Promise.all(
				[...byAccount].map(([accountId, jobs]) => this.pollAccount(accountId, jobs)),
			);
		} finally {
			this.polling = false;
			const anyRemote = [...this.jobs.values()].some((j) => j.stage === "remote" && !j.paused);
			if (anyRemote) this.schedulePoll();
		}
	}

	private async pollAccount(accountId: string, jobs: Job[]): Promise<void> {
		try {
			await withClient(accountId, async (client) => {
				const byId = new Map<string, Torrent>();
				// One list call beats N detail calls once there are a few jobs.
				if (jobs.length > 2) {
					for (const t of await adapter.listTorrents(client, 0, 500)) byId.set(t.id, t);
				}
				for (const job of jobs) {
					let t = byId.get(job.torrentId!);
					try {
						t ??= await adapter.getTorrent(client, job.torrentId!);
					} catch (err) {
						this.fail(job, err, "Torrent is no longer on the account: ");
						this.touch(job);
						continue;
					}
					await this.applyRemote(client, job, t);
				}
			});
		} catch (err) {
			// Account-level failure (network, auth): keep jobs waiting, surface once.
			console.warn(`[poll] ${accountId}:`, errorMessage(err));
		}
	}

	private async applyRemote(client: adapter.RemoteClient, job: Job, t: Torrent): Promise<void> {
		const next = remoteOf(t);
		const prev = job.remote;
		if (!prev || prev.status !== next.status || prev.progress !== next.progress) {
			job.lastRemoteChange = Date.now();
		}
		job.remote = next;
		if (t.name && job.kind !== "cloud" && /^[a-f0-9]{40}$/i.test(job.name)) job.name = t.name;
		if (t.status === "waiting_files_selection") {
			const ids = job.fileKeys?.map(Number).filter(Number.isFinite);
			await adapter.startTorrent(client, t, ids).catch((err) => this.fail(job, err));
		} else if (t.status === "downloaded") {
			job.stage = "resolving";
			this.touch(job);
			this.advance(job);
			return;
		} else if (adapter.isRemoteFailure(t.status)) {
			this.fail(job, new Error(`the service reports "${t.status}"`), "Debrid: ");
		}
		this.touch(job);
	}

	// ------------------------------------------------------------ transfers

	private enqueue(job: Job, task: FileTask): void {
		void this.queue.add(() => this.runTask(job, task)).catch(() => {});
	}

	/** Fresh direct URL for a task (unrestrict / re-list). */
	private async resolveUrl(job: Job, task: FileTask): Promise<string> {
		return withClient(job.accountId, async (c) => {
			if (task.itemId) return (await adapter.itemLink(c, task.itemId)).url;
			if (task.direct) {
				const files = job.torrentId
					? await adapter.listFiles(c, job.torrentId)
					: await adapter.resolveLink(c, job.source!);
				const hit = files.find((f) => f.key === task.key) ?? files.find((f) => basename(f.path) === task.name);
				if (!hit) throw new Error("File is no longer available on the account");
				return hit.link;
			}
			const u = await adapter.unrestrict(c, task.link);
			if (!task.bytesTotal && u.bytes) task.bytesTotal = u.bytes;
			if (/\(part \d+\)$/.test(task.name) && u.filename) {
				task.name = u.filename;
				task.relPath = join(dirname(task.relPath), safeFileName(u.filename));
			}
			return u.url;
		});
	}

	private claimedPaths(): Set<string> {
		const s = new Set<string>();
		for (const j of this.jobs.values()) for (const t of j.tasks) if (t.finalPath) s.add(t.finalPath);
		return s;
	}

	/** Fix the target path on first start. Returns false when skipped. */
	private chooseFinalPath(job: Job, task: FileTask): boolean {
		if (task.finalPath) return true;
		const want = join(job.targetDir ?? job.dir, task.relPath);
		const mode = this.downloads.conflict;
		if (existsSync(want) && mode === "skip") {
			task.finalPath = want;
			task.bytesDone = task.bytesTotal = partSize(want);
			task.status = "completed";
			task.error = "Skipped: file already exists";
			return false;
		}
		let path = want;
		if (mode === "rename") {
			const taken = this.claimedPaths();
			const ext = extname(want);
			const stem = want.slice(0, want.length - ext.length);
			for (let i = 1; existsSync(path) || existsSync(`${path}.part`) || taken.has(path); i++) {
				path = `${stem} (${i})${ext}`;
			}
		}
		task.finalPath = path;
		return true;
	}

	private async runTask(job: Job, task: FileTask): Promise<void> {
		if (task.status !== "queued" || !this.jobs.has(job.id)) return;
		task.status = "active";
		task.error = undefined;
		const ctrl = new AbortController();
		this.controllers.set(task.id, ctrl);
		const meter = new SpeedMeter();
		this.touch(job);
		try {
			if (!this.chooseFinalPath(job, task)) return;
			mkdirSync(dirname(task.finalPath!), { recursive: true });
			let refreshed = false;
			for (;;) {
				task.url ??= await this.resolveUrl(job, task);
				if (ctrl.signal.aborted) throw new DOMException("Aborted", "AbortError");
				try {
					const r = await transfer({
						url: task.url,
						partPath: `${task.finalPath}.part`,
						finalPath: task.finalPath!,
						expectedBytes: task.bytesTotal,
						signal: ctrl.signal,
						limiter: this.limiter,
						onProgress: (done, total) => {
							task.bytesDone = done;
							if (total) task.bytesTotal = total;
							meter.push(done);
							task.speed = meter.bytesPerSec;
							this.hooks.changed(job.id);
						},
					});
					task.resumable = r.resumable;
					task.bytesDone = r.bytes;
					if (!task.bytesTotal) task.bytesTotal = r.bytes;
					break;
				} catch (err) {
					if (ctrl.signal.aborted) throw err;
					// Expired link: unrestrict again once, continue from the .part size.
					if (!refreshed && err instanceof HttpError && err.expired) {
						task.url = undefined;
						refreshed = true;
						continue;
					}
					throw err;
				}
			}
			task.status = "completed";
		} catch (err) {
			if (ctrl.signal.aborted) {
				if (task.status === "active") task.status = "paused";
			} else if (task.retries < this.downloads.retries) {
				task.retries++;
				task.status = "queued";
				task.error = `${errorMessage(err)} — retrying (${task.retries}/${this.downloads.retries})`;
				task.url = undefined;
				const backoff = Math.min(60_000, 2000 * 2 ** (task.retries - 1));
				setTimeout(() => this.enqueue(job, task), backoff);
			} else {
				task.status = "failed";
				task.error = errorMessage(err);
			}
		} finally {
			this.controllers.delete(task.id);
			task.speed = 0;
			this.touch(job);
			this.onTaskSettled(job);
		}
	}

	private onTaskSettled(job: Job): void {
		if (!this.jobs.has(job.id)) return;
		const status = deriveStatus(job);
		if (status === "completed" && !job.completedAt) {
			job.completedAt = new Date().toISOString();
			this.touch(job);
			if (this.general.notify) {
				try {
					Utils.showNotification({ title: "Download complete", body: job.name });
				} catch {
					/* notifications unsupported */
				}
			}
			this.hooks.toast("success", "Download complete", job.name);
			if (this.general.deleteAfter && job.torrentId) {
				void withClient(job.accountId, (c) => adapter.deleteTorrent(c, job.torrentId!)).catch((err) =>
					console.warn("[deleteAfter]", errorMessage(err)),
				);
			}
		} else if (status === "failed" && job.tasks.every((t) => t.status !== "queued" && t.status !== "active")) {
			this.hooks.toast("error", `Failed: ${job.name}`, toPublicJob(job).error);
		}
	}

	// ------------------------------------------------------------ actions

	private pauseTasks(tasks: FileTask[]): void {
		for (const t of tasks) {
			if (t.status === "queued" || t.status === "active") {
				t.status = "paused";
				t.speed = 0;
				this.controllers.get(t.id)?.abort();
			}
		}
	}

	private resumeTasks(job: Job, tasks: FileTask[]): void {
		for (const t of tasks) {
			if (t.status === "paused") {
				t.status = "queued";
				this.enqueue(job, t);
			}
		}
	}

	private retryTasks(job: Job, tasks: FileTask[]): void {
		for (const t of tasks) {
			if (t.status === "failed") {
				t.status = "queued";
				t.retries = 0;
				t.error = undefined;
				t.url = undefined;
				this.enqueue(job, t);
			}
		}
		job.completedAt = undefined;
	}

	private async removeJob(job: Job, deleteFiles: boolean): Promise<void> {
		this.pauseTasks(job.tasks);
		this.jobs.delete(job.id);
		if (job.kind === "torrent" && job.source && job.stage !== "files") {
			rmSync(job.source, { force: true });
		}
		if (deleteFiles) {
			for (const t of job.tasks) {
				if (!t.finalPath) continue;
				rmSync(`${t.finalPath}.part`, { force: true });
				if (t.status === "completed" && existsSync(t.finalPath) && !t.error?.startsWith("Skipped")) {
					try {
						Utils.moveToTrash(t.finalPath);
					} catch {
						rmSync(t.finalPath, { force: true });
					}
				}
			}
		} else {
			// Partial files are useless without the job; completed files stay.
			for (const t of job.tasks) {
				if (t.finalPath && t.status !== "completed") rmSync(`${t.finalPath}.part`, { force: true });
			}
		}
		this.hooks.removed(job.id);
		scheduleSave(() => this.jobs.values());
	}

	async jobAction(ids: string[], action: JobAction): Promise<void> {
		for (const id of ids) {
			const job = this.jobs.get(id);
			if (!job) continue;
			switch (action) {
				case "pause":
					if (job.stage === "files") this.pauseTasks(job.tasks);
					else if (job.stage !== "failed") job.paused = true;
					break;
				case "resume":
					job.paused = false;
					if (job.stage === "files") this.resumeTasks(job, job.tasks);
					else this.advance(job);
					break;
				case "retry":
					job.paused = false;
					if (job.stage === "failed") {
						job.error = undefined;
						job.stage = job.tasks.length ? "files" : job.torrentId ? "remote" : "queued";
						if (job.stage === "files") this.retryTasks(job, job.tasks);
						else this.advance(job);
					} else if (job.stage === "files") {
						this.retryTasks(job, job.tasks);
						this.resumeTasks(job, job.tasks);
					}
					break;
				case "remove":
					await this.removeJob(job, false);
					continue;
				case "removeAndDelete":
					await this.removeJob(job, true);
					continue;
				case "removeFromDebrid":
					if (job.torrentId) {
						try {
							await withClient(job.accountId, (c) => adapter.deleteTorrent(c, job.torrentId!));
						} catch (err) {
							this.hooks.toast("error", "Could not remove from the debrid account", errorMessage(err));
						}
					}
					await this.removeJob(job, false);
					continue;
			}
			this.touch(job);
		}
	}

	taskAction(jobId: string, taskIds: string[], action: "pause" | "resume" | "retry"): void {
		const job = this.jobs.get(jobId);
		if (!job) return;
		const ids = new Set(taskIds);
		const tasks = job.tasks.filter((t) => ids.has(t.id));
		if (action === "pause") this.pauseTasks(tasks);
		if (action === "resume") this.resumeTasks(job, tasks);
		if (action === "retry") this.retryTasks(job, tasks);
		this.touch(job);
	}

	async clearCompleted(): Promise<void> {
		for (const job of [...this.jobs.values()]) {
			if (deriveStatus(job) === "completed") await this.removeJob(job, false);
		}
	}

	openPath(jobId: string, taskId?: string, reveal?: boolean): void {
		const job = this.jobs.get(jobId);
		if (!job) return;
		const task = taskId
			? job.tasks.find((t) => t.id === taskId)
			: job.tasks.length === 1
				? job.tasks[0]
				: undefined;
		const file = task?.finalPath && existsSync(task.finalPath) ? task.finalPath : undefined;
		const folder = job.targetDir ?? job.dir;
		if (file && reveal) Utils.showItemInFolder(file);
		else if (file) Utils.openPath(file);
		else if (existsSync(folder)) Utils.openPath(folder);
		else this.hooks.toast("info", "Nothing on disk yet");
	}

	async copyLink(jobId: string, taskId?: string): Promise<boolean> {
		const job = this.jobs.get(jobId);
		if (!job) return false;
		const tasks = taskId ? job.tasks.filter((t) => t.id === taskId) : job.tasks;
		let text: string;
		if (tasks.length) {
			const urls: string[] = [];
			for (const t of tasks) urls.push((t.url ??= await this.resolveUrl(job, t)));
			text = urls.join("\n");
		} else if (job.kind === "magnet" || job.kind === "link") {
			text = job.source ?? "";
		} else return false;
		Utils.clipboardWriteText(text);
		return true;
	}

	freeBytes(): number | null {
		try {
			const s = statfsSync(this.downloads.dir);
			return Number(s.bavail) * Number(s.bsize);
		} catch {
			return null;
		}
	}
}
