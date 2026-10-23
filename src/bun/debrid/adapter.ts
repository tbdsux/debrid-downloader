// Temporary normalization over debrid-ts until DebridProvider gains these
// methods upstream: deleteTorrent, addTorrentFile, unrestrictLink and
// listDownloads (plus RD file selection inside addMagnet). Delete this file
// once debrid-ts ships them. Everything provider-specific in the app goes
// through here — callers never branch on provider.
import { AllDebrid, DebridError, Premiumize, RealDebrid, type Torrent } from "debrid-ts";
import type { AnyClient } from "../accounts/clients";
import type { CloudFolder, CloudLink } from "../../shared/rpc-schema";

export type RemoteClient = AnyClient;

/** A file inside a debrid torrent/transfer, before it's unrestricted. */
export type RemoteFile = {
	/** Stable per-torrent id (provider file id or index) */
	key: string;
	/** Relative path inside the torrent */
	path: string;
	bytes: number;
	/** Hoster link to unrestrict, or the direct URL when `direct` */
	link: string;
	direct: boolean;
};

export type Unrestricted = { url: string; filename: string; bytes: number };

export async function addMagnet(client: AnyClient, magnet: string): Promise<Torrent> {
	return client.addMagnet(magnet);
}

export async function addTorrentFile(
	client: AnyClient,
	file: Uint8Array,
	filename: string,
): Promise<string> {
	if (client instanceof RealDebrid) return (await client.addTorrentFile(file)).id;
	if (client instanceof AllDebrid) {
		const { files } = await client.uploadMagnetFiles([{ file, filename }]);
		const added = files[0];
		if (!added) throw new DebridError("Empty upload response", 200);
		if (added.error) throw new DebridError(added.error.message, 200, added.error.code);
		return String(added.id);
	}
	const created = await client.createTransferFile(file, { filename });
	if ("type" in created) throw new DebridError("Container files are not supported", 200);
	return created.id;
}

export function getTorrent(client: AnyClient, id: string): Promise<Torrent> {
	return client.getTorrent(id);
}

export function listTorrents(client: AnyClient, offset: number, limit: number): Promise<Torrent[]> {
	return client.listTorrents(offset, limit);
}

/**
 * Real-Debrid only starts after file selection. Call while the torrent sits in
 * `waiting_files_selection`; no-op for other providers.
 */
export async function startTorrent(
	client: AnyClient,
	torrent: Torrent,
	fileIds?: number[],
): Promise<void> {
	if (client instanceof RealDebrid && torrent.status === "waiting_files_selection") {
		await client.selectTorrentFiles(torrent.id, fileIds?.length ? fileIds : "all");
	}
}

export async function deleteTorrent(client: AnyClient, id: string): Promise<void> {
	if (client instanceof RealDebrid) return client.deleteTorrent(id);
	if (client instanceof AllDebrid) {
		await client.deleteMagnet(Number(id));
		return;
	}
	await client.deleteTransfer(id);
}

function flattenAd(
	nodes: { n: string; s?: number; l?: string; e?: unknown[] }[],
	prefix = "",
	out: RemoteFile[] = [],
): RemoteFile[] {
	for (const node of nodes) {
		const path = prefix ? `${prefix}/${node.n}` : node.n;
		if (node.e) flattenAd(node.e as typeof nodes, path, out);
		else if (node.l)
			out.push({ key: String(out.length), path, bytes: node.s ?? 0, link: node.l, direct: false });
	}
	return out;
}

/** Files of a finished torrent, without unrestricting them yet. */
export async function listFiles(client: AnyClient, torrentId: string): Promise<RemoteFile[]> {
	if (client instanceof RealDebrid) {
		const t = await client.getTorrent(torrentId);
		const selected = (t.files ?? []).filter((f) => f.selected);
		if (selected.length && selected.every((f) => f.downloadUrl)) {
			return selected.map((f) => ({
				key: String(f.id),
				path: f.path.replace(/^\/+/, ""),
				bytes: f.bytes,
				link: f.downloadUrl!,
				direct: false,
			}));
		}
		// RD packed the files into an archive (links ≠ selected files): the
		// links are the unit, names come from unrestricting later.
		return t.links.map((link, i) => ({
			key: `l${i}`,
			path: t.links.length === 1 ? t.name : `${t.name} (part ${i + 1})`,
			bytes: t.links.length === 1 ? t.bytes : 0,
			link,
			direct: false,
		}));
	}
	if (client instanceof AllDebrid) {
		const { magnets } = await client.getMagnetFiles([Number(torrentId)]);
		const entry = magnets.find((m) => String(m.id) === String(torrentId));
		if (!entry || entry.error) {
			throw new DebridError(entry?.error?.message ?? "Magnet not found", 404, entry?.error?.code);
		}
		return flattenAd(entry.files ?? []);
	}
	const links = await client.getDownloadLinks(torrentId);
	return links.map((l) => ({
		key: l.id,
		path: l.filename,
		bytes: l.bytes,
		link: l.url,
		direct: true,
	}));
}

/** Hoster link → direct URL. AllDebrid delayed links are awaited. */
export async function unrestrict(client: AnyClient, link: string): Promise<Unrestricted> {
	if (client instanceof RealDebrid) {
		const r = await client.unrestrictLink(link);
		const first = Array.isArray(r) ? r[0] : r;
		if (!first) throw new DebridError("No link returned", 200);
		return { url: first.download, filename: first.filename, bytes: first.filesize };
	}
	if (client instanceof AllDebrid) {
		const r = await client.unlockLink(link);
		const url = r.link || (r.delayed ? await client.waitForDelayedLink(r.delayed) : "");
		if (!url) throw new DebridError("Link could not be unlocked", 200);
		return { url, filename: r.filename, bytes: r.filesize };
	}
	const dl = await client.getDirectDownloadLinks(link);
	const first = dl.content[0];
	if (!first) throw new DebridError("No files for this link", 200);
	return {
		url: first.link,
		filename: first.path.split("/").pop() || first.path,
		bytes: first.size,
	};
}

/**
 * A hoster link may expand to several files (RD multi-quality, PM folders).
 * Returned items are already direct.
 */
export async function resolveLink(client: AnyClient, link: string): Promise<RemoteFile[]> {
	if (client instanceof Premiumize) {
		const dl = await client.getDirectDownloadLinks(link);
		return dl.content.map((c, i) => ({
			key: String(i),
			path: c.path,
			bytes: c.size,
			link: c.link,
			direct: true,
		}));
	}
	const u = await unrestrict(client, link);
	return [{ key: "0", path: u.filename, bytes: u.bytes, link: u.url, direct: true }];
}

export function hasHistory(client: AnyClient): boolean {
	return client instanceof RealDebrid || client instanceof AllDebrid;
}

export async function listHistory(
	client: AnyClient,
	offset: number,
	limit: number,
): Promise<CloudLink[]> {
	if (client instanceof RealDebrid) {
		const items = await client.listDownloads({ offset, limit });
		return items.map((d) => ({
			id: d.id,
			filename: d.filename,
			bytes: d.filesize,
			host: d.host,
			link: d.link,
			addedAt: (d as { generated?: string }).generated,
		}));
	}
	if (client instanceof AllDebrid) {
		const { links } = await client.getUserHistory();
		return links.slice(offset, offset + limit).map((l, i) => ({
			id: `${l.date}-${offset + i}`,
			filename: l.filename,
			bytes: l.size,
			host: l.host,
			link: l.link,
			addedAt: l.date ? new Date(l.date * 1000).toISOString() : undefined,
		}));
	}
	return [];
}

export async function listFolder(client: AnyClient, folderId: string | null): Promise<CloudFolder> {
	if (!(client instanceof Premiumize)) throw new DebridError("Not supported for this service", 400);
	const res = await client.listFolder({
		id: folderId ?? undefined,
		includebreadcrumbs: true,
	});
	const crumbs = (res.breadcrumbs ?? []).map((b, i) => ({
		id: i === 0 ? null : b.id,
		name: i === 0 ? "My files" : b.name,
	}));
	return {
		id: folderId,
		name: res.name,
		breadcrumbs: crumbs.length ? crumbs : [{ id: null, name: "My files" }],
		folders: res.content
			.filter((c) => c.type === "folder")
			.map((c) => ({ id: c.id, name: c.name })),
		files: res.content.flatMap((c) =>
			c.type === "file"
				? [
						{
							id: c.id,
							name: c.name,
							bytes: c.size,
							addedAt: c.created_at ? new Date(c.created_at * 1000).toISOString() : undefined,
						},
					]
				: [],
		),
	};
}

/** PM cloud file → direct link. */
export async function itemLink(client: AnyClient, itemId: string): Promise<Unrestricted> {
	if (!(client instanceof Premiumize)) throw new DebridError("Not supported for this service", 400);
	const d = await client.getItemDetails(itemId);
	return { url: d.link, filename: d.name, bytes: d.size };
}

/** Terminal debrid-side failure states. */
export function isRemoteFailure(status: string): boolean {
	return ["magnet_error", "error", "virus", "dead"].includes(status);
}
