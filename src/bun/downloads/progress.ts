// Speed measurement and a global bandwidth limiter shared by all transfers.

/** Rolling-window speed meter (bytes/s over the last ~3s). */
export class SpeedMeter {
	private samples: { t: number; bytes: number }[] = [];
	constructor(private windowMs = 3000) {}

	push(totalBytes: number, now = Date.now()): void {
		this.samples.push({ t: now, bytes: totalBytes });
		const cutoff = now - this.windowMs;
		while (this.samples.length > 2 && this.samples[0]!.t < cutoff) this.samples.shift();
	}

	get bytesPerSec(): number {
		const first = this.samples[0];
		const last = this.samples[this.samples.length - 1];
		if (!first || !last || last.t === first.t) return 0;
		return Math.max(0, ((last.bytes - first.bytes) * 1000) / (last.t - first.t));
	}

	reset(): void {
		this.samples = [];
	}
}

/**
 * Token bucket in fixed 250ms slices. `limit` is bytes/s, 0 = unlimited.
 * Every transfer awaits take() after writing a chunk, so total throughput
 * across all of them stays under the limit.
 */
export class RateLimiter {
	private sliceStart = Date.now();
	private used = 0;
	constructor(public limit = 0) {}

	async take(bytes: number, signal?: AbortSignal): Promise<void> {
		if (this.limit <= 0) return;
		const sliceMs = 250;
		const budget = (this.limit * sliceMs) / 1000;
		for (;;) {
			const now = Date.now();
			if (now - this.sliceStart >= sliceMs) {
				this.sliceStart = now;
				this.used = 0;
			}
			if (this.used < budget || signal?.aborted) {
				this.used += bytes;
				return;
			}
			await new Promise((r) => setTimeout(r, this.sliceStart + sliceMs - now));
		}
	}
}
