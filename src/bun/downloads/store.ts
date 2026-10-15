// jobs.json persistence: debounced atomic writes. Unrestricted URLs and live
// speeds are never written — URLs are re-resolved after a restart.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { jobsFile } from "../paths";
import type { Job } from "./types";

export function loadJobs(): Job[] {
	try {
		const raw = JSON.parse(readFileSync(jobsFile(), "utf8")) as { version: number; jobs: Job[] };
		return Array.isArray(raw.jobs) ? raw.jobs : [];
	} catch (err) {
		if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
			console.warn("[jobs] could not read jobs.json, starting empty:", err);
		}
		return [];
	}
}

function serialize(jobs: Iterable<Job>): string {
	const out = [...jobs].map((j) => ({
		...j,
		tasks: j.tasks.map(({ url: _url, speed: _speed, ...t }) => ({ ...t, speed: 0 })),
	}));
	return JSON.stringify({ version: 1, jobs: out });
}

export function writeJobsNow(jobs: Iterable<Job>): void {
	const file = jobsFile();
	const tmp = file + ".tmp";
	try {
		writeFileSync(tmp, serialize(jobs), { mode: 0o600 });
		renameSync(tmp, file);
	} catch (err) {
		console.warn("[jobs] save failed:", err);
	}
}

let timer: ReturnType<typeof setTimeout> | undefined;
export function scheduleSave(getJobs: () => Iterable<Job>, delayMs = 1000): void {
	if (timer) return;
	timer = setTimeout(() => {
		timer = undefined;
		writeJobsNow(getJobs());
	}, delayMs);
}

export function flushSave(getJobs: () => Iterable<Job>): void {
	if (timer) clearTimeout(timer);
	timer = undefined;
	writeJobsNow(getJobs());
}
