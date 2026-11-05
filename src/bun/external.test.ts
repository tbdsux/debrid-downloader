import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ExternalInbox, classifyOpenUrl } from "./external";

const HASH = "0123456789abcdef0123456789abcdef01234567";
const dir = mkdtempSync(join(tmpdir(), "dd-ext-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("classifyOpenUrl", () => {
	test("magnets", () => {
		expect(classifyOpenUrl(`magnet:?xt=urn:btih:${HASH}&dn=x`).kind).toBe("magnet");
		expect(classifyOpenUrl("magnet:?xt=nope").kind).toBe("ignored");
	});

	test("torrent files only", () => {
		const t = classifyOpenUrl(pathToFileURL(join(dir, "a b.torrent")).href);
		expect(t).toEqual({ kind: "torrent", path: join(dir, "a b.torrent") });
		expect(classifyOpenUrl(pathToFileURL(join(dir, "x.txt")).href).kind).toBe("ignored");
		expect(classifyOpenUrl("https://example.com/a.torrent").kind).toBe("ignored");
	});
});

describe("ExternalInbox", () => {
	test("merges, de-duplicates and clears on take", () => {
		const path = join(dir, "ubuntu.torrent");
		writeFileSync(path, "d4:infoe");
		const inbox = new ExternalInbox();
		const magnet = `magnet:?xt=urn:btih:${HASH}`;
		expect(inbox.push(magnet)).toBe(true);
		expect(inbox.push(magnet)).toBe(true);
		expect(inbox.push(pathToFileURL(path).href)).toBe(true);
		expect(inbox.push("https://example.com")).toBe(false);
		const got = inbox.take();
		expect(got?.magnets).toEqual([magnet]);
		expect(got?.files).toEqual([{ name: "ubuntu.torrent", base64: btoa("d4:infoe") }]);
		expect(inbox.take()).toBeNull();
	});

	test("missing file is skipped", () => {
		const inbox = new ExternalInbox();
		expect(inbox.push(pathToFileURL(join(dir, "gone.torrent")).href)).toBe(false);
		expect(inbox.take()).toBeNull();
	});
});
