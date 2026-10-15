// Cloud ("Debrid Viewer") reads: what's already on a linked account.
import * as adapter from "./debrid/adapter";
import { withClient } from "./accounts/clients";
import type { CloudAccountInfo, CloudFile, CloudFolder, CloudLink, CloudTorrent } from "../shared/rpc-schema";

export async function accountInfo(accountId: string): Promise<CloudAccountInfo> {
	const u = await withClient(accountId, (c) => c.getUser());
	return {
		username: u.username,
		premium: u.premium,
		expiresAt: u.expiresAt ? u.expiresAt.toISOString() : null,
	};
}

export async function torrents(
	accountId: string,
	offset: number,
	limit: number,
): Promise<{ items: CloudTorrent[]; hasMore: boolean }> {
	// Fetch one extra to know whether another page exists.
	const list = await withClient(accountId, (c) => adapter.listTorrents(c, offset, limit + 1));
	return {
		hasMore: list.length > limit,
		items: list.slice(0, limit).map((t) => ({
			id: t.id,
			name: t.name,
			status: t.status,
			progress: t.progress,
			bytes: t.bytes,
			addedAt: t.addedAt?.toISOString(),
			speed: t.speed,
			seeders: t.seeders,
		})),
	};
}

export async function torrentFiles(accountId: string, id: string): Promise<CloudFile[]> {
	return withClient(accountId, async (c) => {
		const t = await adapter.getTorrent(c, id);
		if (t.status !== "downloaded") {
			// Not finished: show the file list the torrent reports (RD/AD), if any.
			return (t.files ?? []).map((f) => ({ id: String(f.id), path: f.path.replace(/^\/+/, ""), bytes: f.bytes }));
		}
		const files = await adapter.listFiles(c, id);
		return files.map((f) => ({ id: f.key, path: f.path, bytes: f.bytes }));
	});
}

export async function history(
	accountId: string,
	offset: number,
	limit: number,
): Promise<{ items: CloudLink[]; hasMore: boolean }> {
	const list = await withClient(accountId, (c) => adapter.listHistory(c, offset, limit + 1));
	return { hasMore: list.length > limit, items: list.slice(0, limit) };
}

export function folder(accountId: string, folderId: string | null): Promise<CloudFolder> {
	return withClient(accountId, (c) => adapter.listFolder(c, folderId));
}

export async function remove(accountId: string, torrentIds: string[]): Promise<void> {
	await withClient(accountId, async (c) => {
		for (const id of torrentIds) await adapter.deleteTorrent(c, id);
	});
}
