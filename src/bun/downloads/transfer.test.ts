// Range/resume behaviour of transfer() against a mocked fetch.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpError, totalFromContentRange, transfer } from "./transfer";
import { RateLimiter, SpeedMeter } from "./progress";

const DIR = mkdtempSync(join(tmpdir(), "dd-transfer-test-"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const BODY = new TextEncoder().encode("0123456789abcdefghij"); // 20 bytes

/** Fake server: honours Range when `ranged`, else always sends the full body. */
function server(opts: { ranged: boolean; status?: number }) {
	const seen: (string | null)[] = [];
	const fetchImpl = (async (_url: string, init?: RequestInit) => {
		const range = (init?.headers as Record<string, string> | undefined)?.Range ?? null;
		seen.push(range);
		if (opts.status) return new Response(null, { status: opts.status });
		const start = range ? Number(/bytes=(\d+)-/.exec(range)![1]) : 0;
		if (range && opts.ranged) {
			if (start >= BODY.length) {
				return new Response(null, { status: 416, headers: { "content-range": `bytes */${BODY.length}` } });
			}
			return new Response(BODY.slice(start), {
				status: 206,
				headers: { "content-range": `bytes ${start}-${BODY.length - 1}/${BODY.length}` },
			});
		}
		return new Response(BODY, { status: 200, headers: { "content-length": String(BODY.length) } });
	}) as unknown as typeof fetch;
	return { fetchImpl, seen };
}

function paths(name: string) {
	const finalPath = join(DIR, name);
	return { finalPath, partPath: `${finalPath}.part` };
}

const base = { url: "https://x.test/f", expectedBytes: 20, signal: new AbortController().signal, onProgress: () => {} };

describe("transfer", () => {
	test("fresh download writes the file and removes .part", async () => {
		const p = paths("fresh.bin");
		const s = server({ ranged: true });
		const r = await transfer({ ...base, ...p, fetchImpl: s.fetchImpl });
		expect(r).toEqual({ bytes: 20, resumable: true });
		expect(readFileSync(p.finalPath)).toEqual(Buffer.from(BODY));
		expect(existsSync(p.partPath)).toBe(false);
		expect(s.seen).toEqual([null]);
	});

	test("resumes from the .part size with a Range request (206)", async () => {
		const p = paths("resume.bin");
		writeFileSync(p.partPath, BODY.slice(0, 8));
		const s = server({ ranged: true });
		const progress: number[] = [];
		await transfer({ ...base, ...p, fetchImpl: s.fetchImpl, onProgress: (d) => progress.push(d) });
		expect(s.seen).toEqual(["bytes=8-"]);
		expect(progress[0]).toBe(8);
		expect(readFileSync(p.finalPath)).toEqual(Buffer.from(BODY));
	});

	test("200 to a Range request restarts and marks not resumable", async () => {
		const p = paths("norange.bin");
		writeFileSync(p.partPath, BODY.slice(0, 8));
		const s = server({ ranged: false });
		const r = await transfer({ ...base, ...p, fetchImpl: s.fetchImpl });
		expect(r.resumable).toBe(false);
		expect(readFileSync(p.finalPath)).toEqual(Buffer.from(BODY)); // not 8 + 20 bytes
	});

	test("416 with a complete .part finishes without downloading", async () => {
		const p = paths("done.bin");
		writeFileSync(p.partPath, BODY);
		const s = server({ ranged: true });
		const r = await transfer({ ...base, ...p, fetchImpl: s.fetchImpl });
		expect(r.bytes).toBe(20);
		expect(readFileSync(p.finalPath)).toEqual(Buffer.from(BODY));
	});

	test("expired link surfaces as HttpError.expired", async () => {
		const p = paths("gone.bin");
		const s = server({ ranged: true, status: 403 });
		const err = await transfer({ ...base, ...p, fetchImpl: s.fetchImpl }).catch((e) => e);
		expect(err).toBeInstanceOf(HttpError);
		expect((err as HttpError).expired).toBe(true);
	});

	test("content-range parsing", () => {
		expect(totalFromContentRange("bytes 100-199/1000")).toBe(1000);
		expect(totalFromContentRange("bytes */20")).toBe(20);
		expect(totalFromContentRange(null)).toBe(0);
	});
});

describe("progress helpers", () => {
	test("speed meter averages over the window", () => {
		const m = new SpeedMeter(3000);
		m.push(0, 0);
		m.push(1000, 500);
		m.push(4000, 2000);
		expect(m.bytesPerSec).toBe(2000);
	});

	test("rate limiter throttles to roughly the limit", async () => {
		const l = new RateLimiter(40_000); // 10k per 250ms slice
		const t0 = Date.now();
		for (let i = 0; i < 4; i++) await l.take(10_000);
		expect(Date.now() - t0).toBeGreaterThanOrEqual(500);
	});
});
