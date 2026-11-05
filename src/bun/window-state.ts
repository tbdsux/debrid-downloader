// Remembers the main window's size and position between launches
// (window.json in the app data dir).
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./paths";
import { MIN_HEIGHT, MIN_WIDTH, fitFrame, type Frame } from "./window-frame";

type Rect = Frame;

const file = () => join(dataDir(), "window.json");

export function loadFrame(workAreas: Rect[]): Frame {
	try {
		return fitFrame(JSON.parse(readFileSync(file(), "utf8")), workAreas);
	} catch {
		return fitFrame(undefined, workAreas);
	}
}

let pending: Frame | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

function writeNow(): void {
	if (timer) clearTimeout(timer);
	timer = undefined;
	if (!pending) return;
	const f = pending;
	pending = undefined;
	try {
		const tmp = `${file()}.tmp`;
		writeFileSync(tmp, JSON.stringify(f));
		renameSync(tmp, file());
	} catch (err) {
		console.warn("[window] could not save window frame:", err);
	}
}

/** Debounced: resize/move fire continuously while dragging. */
export function saveFrame(f: Frame): void {
	if (f.width < MIN_WIDTH || f.height < MIN_HEIGHT) return; // minimized / transient
	pending = {
		x: Math.round(f.x),
		y: Math.round(f.y),
		width: Math.round(f.width),
		height: Math.round(f.height),
	};
	if (!timer) timer = setTimeout(writeNow, 600);
}

export const flushFrame = writeNow;
