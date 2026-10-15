import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon, FileIcon, FolderIcon, Loader2Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { ago, bytes } from "@/lib/format";
import { rpc } from "@/lib/rpc";
import type { AccountPublic } from "../../../shared/rpc-schema";
import { CloudEmpty, CloudError, useSendToDownloads, type TabApi } from "./shared";

const GRID = "grid grid-cols-[32px_minmax(220px,1fr)_88px_110px] items-center";

/** Premiumize cloud storage browser. */
export function FilesTab({
	account,
	search,
	onApi,
}: {
	account: AccountPublic;
	search: string;
	onApi: (api: TabApi) => void;
}) {
	const send = useSendToDownloads();
	const [folderId, setFolderId] = useState<string | null>(null);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const q = useQuery({
		queryKey: ["cloud", account.id, "folder", folderId],
		queryFn: () => rpc.request.cloudFolder({ accountId: account.id, folderId }),
		retry: false,
	});
	const s = search.trim().toLowerCase();
	const folders = useMemo(
		() => (q.data?.folders ?? []).filter((f) => !s || f.name.toLowerCase().includes(s)),
		[q.data, s],
	);
	const files = useMemo(
		() => (q.data?.files ?? []).filter((f) => !s || f.name.toLowerCase().includes(s)),
		[q.data, s],
	);

	useEffect(() => setSelected(new Set()), [folderId]);
	useEffect(() => {
		const chosen = (q.data?.files ?? []).filter((f) => selected.has(f.id));
		onApi({
			selectedCount: chosen.length,
			download: () =>
				void send(async () => {
					const jobs = await rpc.request.cloudDownloadItems({
						accountId: account.id,
						items: chosen.map((f) => ({ id: f.id, name: f.name, bytes: f.bytes })),
					});
					setSelected(new Set());
					return jobs;
				}),
		});
	}, [selected, q.data, account, onApi, send]);

	if (q.error) return <CloudError error={q.error} onRetry={() => q.refetch()} />;
	const toggle = (id: string) =>
		setSelected((prev) => {
			const n = new Set(prev);
			if (n.has(id)) n.delete(id);
			else n.add(id);
			return n;
		});
	const allSel = files.length > 0 && files.every((f) => selected.has(f.id));

	return (
		<div className="flex h-full flex-col">
			<div className="flex h-8 shrink-0 items-center gap-1 border-b px-3 text-[12.5px]">
				{(q.data?.breadcrumbs ?? [{ id: null, name: "My files" }]).map((b, i, arr) => (
					<Fragment key={b.id ?? "root"}>
						{i > 0 && <ChevronRightIcon className="size-3.5 text-muted-foreground" />}
						<button
							type="button"
							onClick={() => setFolderId(b.id)}
							className={cn(
								"rounded px-1 hover:bg-accent",
								i === arr.length - 1 ? "font-medium text-foreground" : "text-muted-foreground",
							)}
						>
							{b.name}
						</button>
					</Fragment>
				))}
			</div>
			<div className="min-h-0 flex-1 overflow-auto">
				<div className="min-w-[560px]">
					<div
						className={cn(
							GRID,
							"sticky top-0 z-10 h-8 border-b bg-chrome/95 text-[11.5px] font-medium text-muted-foreground backdrop-blur",
						)}
					>
						<div className="flex justify-center">
							<Checkbox
								checked={allSel}
								indeterminate={selected.size > 0 && !allSel}
								onCheckedChange={() => setSelected(allSel ? new Set() : new Set(files.map((f) => f.id)))}
								aria-label="Select all files"
							/>
						</div>
						<div className="px-2">Name</div>
						<div className="px-2 text-right">Size</div>
						<div className="px-2">Added</div>
					</div>
					{q.isPending ? (
						<div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
							<Loader2Icon className="size-4 animate-spin" /> Loading…
						</div>
					) : folders.length + files.length === 0 ? (
						<CloudEmpty text={s ? "Nothing matches the filter." : "This folder is empty."} />
					) : (
						<>
							{folders.map((f) => (
								<div
									key={f.id}
									onDoubleClick={() => setFolderId(f.id)}
									className={cn(GRID, "h-9 border-b border-border/60 text-[13px] hover:bg-accent/60")}
									title="Double-click to open"
								>
									<div />
									<div className="flex min-w-0 items-center gap-2 px-2">
										<FolderIcon className="size-4 shrink-0 text-primary" />
										<span className="truncate">{f.name}</span>
									</div>
									<div />
									<div />
								</div>
							))}
							{files.map((f) => (
								<div
									key={f.id}
									onMouseDown={(e) => e.button === 0 && toggle(f.id)}
									className={cn(
										GRID,
										"h-9 border-b border-border/60 text-[13px] transition-colors",
										selected.has(f.id) ? "bg-primary/10 hover:bg-primary/15" : "hover:bg-accent/60",
									)}
								>
									<div className="flex justify-center" onMouseDown={(e) => e.stopPropagation()}>
										<Checkbox checked={selected.has(f.id)} onCheckedChange={() => toggle(f.id)} />
									</div>
									<div className="flex min-w-0 items-center gap-2 px-2">
										<FileIcon className="size-4 shrink-0 text-muted-foreground" />
										<span className="truncate" title={f.name}>
											{f.name}
										</span>
									</div>
									<div className="px-2 text-right text-muted-foreground tabular-nums">{bytes(f.bytes)}</div>
									<div className="px-2 text-[12px] text-muted-foreground">{ago(f.addedAt)}</div>
								</div>
							))}
						</>
					)}
				</div>
			</div>
		</div>
	);
}
