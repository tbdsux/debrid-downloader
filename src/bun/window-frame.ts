// Pure window-frame validation (no Electrobun imports, so it is unit-testable).
export type Frame = { x: number; y: number; width: number; height: number };
type Rect = Frame;

export const DEFAULT_FRAME: Frame = { x: 160, y: 120, width: 1100, height: 720 };
export const MIN_WIDTH = 760;
export const MIN_HEIGHT = 480;
/** How much of the window must stay on a display for the saved spot to count. */
const MIN_VISIBLE = 120;

function num(v: unknown): number {
	return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : Number.NaN;
}

function overlap(a: Rect, b: Rect): { w: number; h: number } {
	const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
	const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
	return { w: Math.max(0, w), h: Math.max(0, h) };
}

/**
 * Validate a saved frame against the connected displays' work areas. A frame
 * that's malformed, too small, or no longer on any screen (monitor unplugged)
 * falls back to the default position, keeping the saved size when it fits.
 */
export function fitFrame(saved: unknown, workAreas: Rect[]): Frame {
	if (!saved || typeof saved !== "object") return DEFAULT_FRAME;
	const r = saved as Record<string, unknown>;
	const f = { x: num(r.x), y: num(r.y), width: num(r.width), height: num(r.height) };
	if (Object.values(f).some(Number.isNaN)) return DEFAULT_FRAME;
	if (f.width < MIN_WIDTH || f.height < MIN_HEIGHT) return DEFAULT_FRAME;

	const areas = workAreas.filter((a) => a.width > 0 && a.height > 0);
	// No display info (headless / FFI unavailable): trust the saved frame.
	if (!areas.length) return f;

	const visible = areas.some((a) => {
		const o = overlap(f, a);
		return o.w >= MIN_VISIBLE && o.h >= MIN_VISIBLE / 2;
	});
	if (visible) return f;

	const primary = areas[0]!;
	const width = Math.min(f.width, primary.width);
	const height = Math.min(f.height, primary.height);
	return {
		x: primary.x + Math.max(0, Math.round((primary.width - width) / 2)),
		y: primary.y + Math.max(0, Math.round((primary.height - height) / 2)),
		width,
		height,
	};
}
