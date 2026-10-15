import prettyBytes from "pretty-bytes";
import { formatDistanceToNowStrict } from "date-fns";
import type { JobPublic, JobStatus } from "../../shared/rpc-schema";

export function bytes(n: number | undefined, fallback = "—"): string {
	if (!n || n <= 0) return fallback;
	return prettyBytes(n, { maximumFractionDigits: 1 });
}

export function speed(n: number | undefined): string {
	if (!n || n < 1) return "";
	return `${prettyBytes(n, { maximumFractionDigits: 1 })}/s`;
}

export function eta(remaining: number, bytesPerSec: number): string {
	if (!bytesPerSec || bytesPerSec < 1 || remaining <= 0) return "";
	const s = Math.round(remaining / bytesPerSec);
	if (s < 60) return `${s}s`;
	if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
	if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
	return `${Math.floor(s / 86400)}d`;
}

export function ago(iso: string | undefined): string {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	return `${formatDistanceToNowStrict(d)} ago`;
}

export function pct(done: number, total: number): number {
	if (!total) return 0;
	return Math.min(100, Math.max(0, (done / total) * 100));
}

/** Progress shown for a job: remote progress while the service works, local after. */
export function jobProgress(j: JobPublic): number {
	if (j.status === "completed") return 100;
	if (j.status === "remote" || j.status === "submitting" || j.status === "resolving") {
		return j.remote?.progress ?? 0;
	}
	if (j.status === "paused" && !j.tasks.length) return j.remote?.progress ?? 0;
	return pct(j.bytesDone, j.bytesTotal);
}

export const STATUS_LABEL: Record<JobStatus, string> = {
	queued: "Queued",
	submitting: "Adding to service",
	remote: "Service downloading",
	resolving: "Preparing files",
	downloading: "Downloading",
	paused: "Paused",
	completed: "Completed",
	failed: "Failed",
};

const REMOTE_LABEL: Record<string, string> = {
	magnet_conversion: "Fetching metadata",
	waiting_files_selection: "Selecting files",
	queued: "Queued on service",
	downloading: "Service downloading",
	compressing: "Service compressing",
	uploading: "Service uploading",
	downloaded: "Ready on service",
};

export function statusText(j: JobPublic): string {
	if (j.status === "remote" && j.remote) {
		const base = REMOTE_LABEL[j.remote.status] ?? STATUS_LABEL.remote;
		return base;
	}
	if (j.status === "downloading") {
		const active = j.tasks.filter((t) => t.status === "active").length;
		const queued = j.tasks.filter((t) => t.status === "queued").length;
		if (!active && queued) return "Waiting for a slot";
	}
	return STATUS_LABEL[j.status];
}

/** Tailwind text color class per status. */
export const STATUS_TONE: Record<JobStatus, string> = {
	queued: "text-muted-foreground",
	submitting: "text-info",
	remote: "text-warning",
	resolving: "text-info",
	downloading: "text-primary",
	paused: "text-muted-foreground",
	completed: "text-success",
	failed: "text-destructive",
};

/** Progress bar fill per status. */
export const STATUS_BAR: Record<JobStatus, string> = {
	queued: "bg-muted-foreground/40",
	submitting: "bg-info",
	remote: "bg-warning",
	resolving: "bg-info",
	downloading: "bg-primary",
	paused: "bg-muted-foreground/50",
	completed: "bg-success",
	failed: "bg-destructive",
};
