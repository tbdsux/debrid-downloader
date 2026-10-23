// Tiny, pure input parsing for the add dialog / clipboard detection.

export type ParsedMagnet = { hash: string; name?: string; uri: string };

const BTIH = /^urn:btih:([a-f0-9]{40}|[a-z2-7]{32})$/i;

export function parseMagnet(input: string): ParsedMagnet | null {
	const uri = input.trim();
	if (/^[a-f0-9]{40}$/i.test(uri)) {
		return { hash: uri.toLowerCase(), uri: `magnet:?xt=urn:btih:${uri.toLowerCase()}` };
	}
	if (!uri.toLowerCase().startsWith("magnet:?")) return null;
	const params = new URLSearchParams(uri.slice(8));
	const xt = params
		.getAll("xt")
		.map((x) => BTIH.exec(x))
		.find(Boolean);
	if (!xt) return null;
	const name = params.get("dn")?.trim();
	return { hash: xt[1].toLowerCase(), name: name || undefined, uri };
}

export function isHttpUrl(input: string): boolean {
	try {
		const u = new URL(input.trim());
		return u.protocol === "http:" || u.protocol === "https:";
	} catch {
		return false;
	}
}

/** Split a textarea into non-empty, de-duplicated lines. */
export function splitLines(text: string): string[] {
	return [
		...new Set(
			text
				.split(/\r?\n/)
				.map((l) => l.trim())
				.filter(Boolean),
		),
	];
}

/** Clipboard text → first magnet or http(s) link, else null. */
export function clipboardCandidate(text: string | null): string | null {
	if (!text) return null;
	const first = text.trim().split(/\s+/)[0] ?? "";
	if (first.length > 8192) return null;
	if (parseMagnet(first)) return first;
	// Only links that point at a file (…/name.ext); plain web pages are noise.
	if (isHttpUrl(first) && /\/[^/]+\.[a-z0-9]{2,5}$/i.test(new URL(first).pathname)) return first;
	return null;
}

/** Best display name for a link before it's resolved. */
export function nameFromUrl(url: string): string {
	try {
		const u = new URL(url);
		const last = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "");
		return last || u.hostname;
	} catch {
		return url;
	}
}

/** Strip characters that are invalid in file names on any major OS. */
export function safeFileName(name: string): string {
	const cleaned = name
		// oxlint-disable-next-line no-control-regex -- stripping control chars is the point
		.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
		.replace(/^[.\s]+|[.\s]+$/g, "")
		.slice(0, 200);
	return cleaned || "download";
}
