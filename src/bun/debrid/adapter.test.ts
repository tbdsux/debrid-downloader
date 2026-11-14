import { describe, expect, test } from "bun:test";
import { DebridLink, EasyDebrid, Offcloud, Putio, TorBox } from "debrid-ts";
import * as adapter from "./adapter";

/** A fetch that answers by URL path, so tests don't depend on call order. */
function routes(table: Record<string, unknown>) {
	const calls: { path: string; init: RequestInit }[] = [];
	const fetch = (async (url: URL, init: RequestInit) => {
		calls.push({ path: url.pathname, init });
		if (!(url.pathname in table)) return new Response("{}", { status: 404 });
		return new Response(JSON.stringify(table[url.pathname]));
	}) as unknown as typeof globalThis.fetch;
	return { fetch, calls };
}
const tb = (data: unknown) => ({ success: true, error: null, detail: "", data });
const dl = (value: unknown) => ({ success: true, value });

describe("TorBox", () => {
	const torrent = {
		id: 7,
		hash: "abc",
		name: "Movie",
		size: 5,
		created_at: "2026-01-01T00:00:00Z",
		download_state: "cached",
		progress: 1,
		download_speed: 0,
		seeds: 0,
		ratio: 0,
		download_present: true,
		download_finished: true,
		files: [{ id: 3, name: "Movie/a.mkv", size: 5 }],
	};

	test("files defer their link, which unrestrict then resolves", async () => {
		const { fetch } = routes({
			"/v1/api/torrents/mylist": tb(torrent),
			"/v1/api/torrents/requestdl": tb("https://cdn/a"),
		});
		const client = new TorBox("k", { fetch });
		const [file] = await adapter.listFiles(client, "7");
		expect(file).toEqual({
			key: "3",
			path: "Movie/a.mkv",
			bytes: 5,
			link: "7:3",
			direct: false,
		});
		expect((await adapter.unrestrict(client, file!.link)).url).toBe("https://cdn/a");
	});

	test("adds .torrent files and deletes", async () => {
		const { fetch, calls } = routes({
			"/v1/api/torrents/createtorrent": tb({ torrent_id: 7, hash: "abc" }),
			"/v1/api/torrents/controltorrent": tb(null),
		});
		const client = new TorBox("k", { fetch });
		expect(await adapter.addTorrentFile(client, new Uint8Array([1]), "a.torrent")).toBe("7");
		await adapter.deleteTorrent(client, "7");
		expect(calls.map((c) => c.path)).toContain("/v1/api/torrents/controltorrent");
	});
});

describe("put.io", () => {
	test("files defer their link, which unrestrict then resolves", async () => {
		const { fetch } = routes({
			"/v2/transfers/9": { transfer: { id: 9, name: "a", status: "COMPLETED", file_id: 2 } },
			"/v2/files/2": { file: { id: 2, name: "a.mp4", size: 7, content_type: "video/mp4" } },
			"/v2/files/2/url": { url: "https://s/a" },
		});
		const client = new Putio("k", { fetch });
		const [file] = await adapter.listFiles(client, "9");
		expect(file).toEqual({ key: "2", path: "a.mp4", bytes: 7, link: "2", direct: false });
		expect((await adapter.unrestrict(client, file!.link)).url).toBe("https://s/a");
	});
});

describe("Debrid-Link", () => {
	const link = { id: "l1", name: "a.zip", url: "u", downloadUrl: "https://dl/a", size: 4 };

	test("resolveLink expands a folder link into direct files", async () => {
		const { fetch } = routes({ "/api/v2/downloader/add": dl([link, { ...link, id: "l2" }]) });
		const files = await adapter.resolveLink(new DebridLink("k", { fetch }), "https://host/x");
		expect(files.map((f) => f.key)).toEqual(["l1", "l2"]);
		expect(files.every((f) => f.direct && f.link === "https://dl/a")).toBe(true);
	});

	test("torrent files are direct", async () => {
		const file = {
			id: "f1",
			name: "a",
			size: 1,
			downloadUrl: "https://dl/f",
			downloadPercent: 100,
		};
		const { fetch } = routes({ "/api/v2/seedbox/list": dl([{ id: "t", files: [file] }]) });
		const [out] = await adapter.listFiles(new DebridLink("k", { fetch }), "t");
		expect(out).toMatchObject({ key: "f1", link: "https://dl/f", direct: true });
	});
});

describe("Offcloud", () => {
	test("torrent files are direct", async () => {
		const { fetch } = routes({
			"/api/cloud/explore/r1": { files: [{ size: 1, path: "M/a", url: "https://oc/a" }] },
		});
		const [out] = await adapter.listFiles(new Offcloud("k", { fetch }), "r1");
		expect(out).toEqual({ key: "M/a", path: "M/a", bytes: 1, link: "https://oc/a", direct: true });
	});
});

describe("EasyDebrid", () => {
	test("delete makes no request because nothing is stored", async () => {
		const { fetch, calls } = routes({});
		await adapter.deleteTorrent(new EasyDebrid("k", { fetch }), "abc");
		expect(calls).toEqual([]);
	});
});

describe("unsupported inputs fail with a clear message and no request", () => {
	test.each([
		["Offcloud", () => new Offcloud("k", { fetch: routes({}).fetch })],
		["EasyDebrid", () => new EasyDebrid("k", { fetch: routes({}).fetch })],
	])("%s rejects .torrent files", async (_name, make) => {
		await expect(adapter.addTorrentFile(make(), new Uint8Array([1]), "a")).rejects.toThrow(
			".torrent",
		);
	});

	test.each([
		["TorBox", () => new TorBox("k", { fetch: routes({}).fetch })],
		["Offcloud", () => new Offcloud("k", { fetch: routes({}).fetch })],
		["put.io", () => new Putio("k", { fetch: routes({}).fetch })],
		["EasyDebrid", () => new EasyDebrid("k", { fetch: routes({}).fetch })],
	])("%s rejects hoster links", async (_name, make) => {
		await expect(adapter.resolveLink(make(), "https://host/x")).rejects.toThrow("direct links");
	});
});
