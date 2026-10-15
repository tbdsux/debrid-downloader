// One HTTP file download into `<final>.part`, resuming with a Range request.
// Pure I/O: no job/state knowledge, so it can be tested with a mocked fetch.
import { open, rename, rm, stat } from "node:fs/promises";
import type { RateLimiter } from "./progress";

export class HttpError extends Error {
	constructor(readonly status: number) {
		super(`HTTP ${status}`);
	}
	/** Link probably expired / revoked — worth re-unrestricting once. */
	get expired(): boolean {
		return this.status === 401 || this.status === 403 || this.status === 404 || this.status === 410;
	}
}

export type TransferOptions = {
	url: string;
	partPath: string;
	finalPath: string;
	/** Expected size if known (0 = unknown). */
	expectedBytes: number;
	signal: AbortSignal;
	limiter?: RateLimiter;
	/** Called with total bytes on disk; may be called often. */
	onProgress: (bytesDone: number, bytesTotal: number) => void;
	fetchImpl?: typeof fetch;
};

export type TransferResult = { bytes: number; resumable: boolean };

async function sizeOf(path: string): Promise<number> {
	try {
		return (await stat(path)).size;
	} catch {
		return 0;
	}
}

/** Parse "bytes 100-199/1000" → 1000 (or 0 when unknown). */
export function totalFromContentRange(header: string | null): number {
	const m = header ? /\/(\d+)\s*$/.exec(header) : null;
	return m ? Number(m[1]) : 0;
}

export async function transfer(opts: TransferOptions): Promise<TransferResult> {
	const doFetch = opts.fetchImpl ?? fetch;
	let start = await sizeOf(opts.partPath);
	if (opts.expectedBytes > 0 && start > opts.expectedBytes) {
		await rm(opts.partPath, { force: true });
		start = 0;
	}

	const headers: Record<string, string> = {};
	if (start > 0) headers.Range = `bytes=${start}-`;
	const res = await doFetch(opts.url, { headers, signal: opts.signal, redirect: "follow" });

	let resumable = true;
	let total = opts.expectedBytes;

	if (res.status === 416) {
		// Range not satisfiable: we already have everything (or the part is bogus).
		await res.body?.cancel().catch(() => {});
		const known = totalFromContentRange(res.headers.get("content-range")) || opts.expectedBytes;
		if (known > 0 && start === known) {
			await rename(opts.partPath, opts.finalPath);
			opts.onProgress(start, known);
			return { bytes: start, resumable };
		}
		await rm(opts.partPath, { force: true });
		throw new HttpError(416);
	}
	if (!res.ok) {
		await res.body?.cancel().catch(() => {});
		throw new HttpError(res.status);
	}

	if (res.status === 206) {
		total = totalFromContentRange(res.headers.get("content-range")) || total;
	} else {
		// 200: server ignored Range (or we started from 0) → full body.
		if (start > 0) resumable = false;
		start = 0;
		const len = Number(res.headers.get("content-length"));
		if (Number.isFinite(len) && len > 0) total = len;
	}
	if (res.headers.get("accept-ranges") === "none") resumable = false;

	const fh = await open(opts.partPath, start > 0 ? "a" : "w");
	let done = start;
	try {
		const reader = res.body!.getReader();
		opts.onProgress(done, total);
		for (;;) {
			const { done: eof, value } = await reader.read();
			if (eof) break;
			if (!value?.byteLength) continue;
			await fh.write(value);
			done += value.byteLength;
			opts.onProgress(done, total);
			if (opts.limiter) await opts.limiter.take(value.byteLength, opts.signal);
		}
	} finally {
		await fh.close();
	}

	if (total > 0 && done !== total) {
		throw new Error(`Incomplete download: got ${done} of ${total} bytes`);
	}
	await rename(opts.partPath, opts.finalPath);
	return { bytes: done, resumable };
}
