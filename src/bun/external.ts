// "Open with" integration: magnet: links and .torrent files handed to the app
// by the OS (macOS "open-url" event). They're collected here and offered in
// the Add dialog — nothing is added without the user confirming.
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMagnet } from "./debrid/magnet";
import type { ExternalAdd } from "../shared/rpc-schema";

/** .torrent files are small; anything bigger is not a torrent. */
const MAX_TORRENT_BYTES = 16 * 1024 * 1024;

export type OpenUrlItem =
	| { kind: "magnet"; uri: string }
	| { kind: "torrent"; path: string }
	| { kind: "ignored"; reason: string };

/** Classify a URL the OS opened the app with. Pure — no I/O. */
export function classifyOpenUrl(url: string): OpenUrlItem {
	const u = url.trim();
	if (/^magnet:/i.test(u)) {
		return parseMagnet(u) ? { kind: "magnet", uri: u } : { kind: "ignored", reason: "bad magnet" };
	}
	if (/^file:/i.test(u)) {
		let path: string;
		try {
			path = fileURLToPath(u);
		} catch {
			return { kind: "ignored", reason: "bad file url" };
		}
		return /\.torrent$/i.test(path)
			? { kind: "torrent", path }
			: { kind: "ignored", reason: "not a .torrent" };
	}
	return { kind: "ignored", reason: "unsupported scheme" };
}

export class ExternalInbox {
	private magnets: string[] = [];
	private files: ExternalAdd["files"] = [];

	/** Returns true when something was queued. */
	push(url: string): boolean {
		const item = classifyOpenUrl(url);
		if (item.kind === "magnet") {
			if (!this.magnets.includes(item.uri)) this.magnets.push(item.uri);
			return true;
		}
		if (item.kind === "torrent") {
			try {
				if (statSync(item.path).size > MAX_TORRENT_BYTES) return false;
				const name = basename(item.path);
				if (this.files.some((f) => f.name === name)) return true;
				this.files.push({ name, base64: readFileSync(item.path).toString("base64") });
				return true;
			} catch (err) {
				console.warn("[open-url] could not read", item.path, err);
				return false;
			}
		}
		console.log(`[open-url] ignored (${item.reason}):`, url.slice(0, 120));
		return false;
	}

	/** Everything queued so far, merged; clears the inbox. */
	take(): ExternalAdd | null {
		if (!this.magnets.length && !this.files.length) return null;
		const out = { magnets: this.magnets, files: this.files };
		this.magnets = [];
		this.files = [];
		return out;
	}
}
