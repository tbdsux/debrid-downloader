import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { toast } from "sonner";
import { ChevronRightIcon, FileIcon, Loader2Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Bar } from "@/components/app-ui";
import { ago, bytes, speed } from "@/lib/format";
import { errText, rpc } from "@/lib/rpc";
import type { AccountPublic, CloudTorrent } from "../../../shared/rpc-schema";
import { CloudEmpty, CloudError, LoadMore, useSendToDownloads, type TabApi } from "./shared";

const PAGE = 100;
const GRID = "grid grid-cols-[32px_minmax(220px,1fr)_88px_minmax(150px,200px)_110px] items-center";

const STATUS: Record<string, { label: string; tone: string }> = {
	downloaded: { label: "Ready", tone: "text-success" },
	downloading: { label: "Downloading", tone: "text-warning" },
	queued: { label: "Queued", tone: "text-muted-foreground" },
	magnet_conversion: { label: "Fetching metadata", tone: "text-info" },
	waiting_files_selection: { label: "Needs file selection", tone: "text-warning" },
	compressing: { label: "Compressing", tone: "text-info" },
	uploading: { label: "Uploading", tone: "text-info" },
};
const statusOf = (s: string) =>
	STATUS[s] ?? { label: s.replace(/_/g, " "), tone: "text-destructive" };
const isFinal = (s: string) => s === "downloaded" || !(s in STATUS);

type Row = { type: "torrent"; t: CloudTorrent } | { type: "files"; t: CloudTorrent };

export function TorrentsTab({
	account,
	search,
	onApi,
}: {
	account: AccountPublic;
	search: string;
	onApi: (api: TabApi) => void;
}) {
	const qc = useQueryClient();
	const send = useSendToDownloads();
	const q = useInfiniteQuery({
		queryKey: ["cloud", account.id, "torrents"],
		queryFn: ({ pageParam }) =>
			rpc.request.cloudTorrents({ accountId: account.id, offset: pageParam, limit: PAGE }),
		initialPageParam: 0,
		getNextPageParam: (last, pages) => (last.hasMore ? pages.length * PAGE : undefined),
		// Keep progress live only while something is still processing remotely.
		refetchInterval: (query) =>
			query.state.data?.pages.some((p) => p.items.some((t) => !isFinal(t.status))) ? 15_000 : false,
		retry: false,
	});
	const all = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
	const items = useMemo(() => {
		const s = search.trim().toLowerCase();
		return s ? all.filter((t) => t.name.toLowerCase().includes(s)) : all;
	}, [all, search]);

	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [expanded, setExpanded] = useState<string | null>(null);

	useEffect(() => {
		const byId = new Map(all.map((t) => [t.id, t]));
		const chosen = [...selected].map((id) => byId.get(id)).filter(Boolean) as CloudTorrent[];
		onApi({
			selectedCount: chosen.length,
			download: () =>
				void send(async () => {
					const out = [];
					for (const t of chosen) {
						out.push(
							...(await rpc.request.cloudDownload({
								accountId: account.id,
								torrentId: t.id,
								name: t.name,
							})),
						);
					}
					setSelected(new Set());
					return out;
				}),
			remove: async () => {
				try {
					await rpc.request.cloudDelete({
						accountId: account.id,
						torrentIds: chosen.map((t) => t.id),
					});
					toast.success(`Deleted ${chosen.length} from ${account.label}`);
					setSelected(new Set());
					void qc.invalidateQueries({ queryKey: ["cloud", account.id, "torrents"] });
				} catch (err) {
					toast.error(errText(err));
				}
			},
		});
	}, [selected, all, account, onApi, send, qc]);

	const rows = useMemo<Row[]>(() => {
		const out: Row[] = [];
		for (const t of items) {
			out.push({ type: "torrent", t });
			if (expanded === t.id) out.push({ type: "files", t });
		}
		return out;
	}, [items, expanded]);

	const scrollRef = useRef<HTMLDivElement>(null);
	const v = useVirtualizer({
		count: rows.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: (i) => (rows[i]?.type === "files" ? 200 : 36),
		overscan: 10,
		getItemKey: (i) => (rows[i]!.type === "files" ? `${rows[i]!.t.id}:files` : rows[i]!.t.id),
	});

	if (q.error) return <CloudError error={q.error} onRetry={() => q.refetch()} />;

	const allSel = items.length > 0 && items.every((t) => selected.has(t.id));
	const toggle = (id: string) =>
		setSelected((prev) => {
			const n = new Set(prev);
			if (n.has(id)) n.delete(id);
			else n.add(id);
			return n;
		});

	return (
		<div ref={scrollRef} className="h-full overflow-auto">
			<div className="min-w-[680px]">
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
							onCheckedChange={() =>
								setSelected(allSel ? new Set() : new Set(items.map((t) => t.id)))
							}
							aria-label="Select all"
						/>
					</div>
					<div className="px-2">Name</div>
					<div className="px-2 text-right">Size</div>
					<div className="px-2">Status</div>
					<div className="px-2">Added</div>
				</div>
				{q.isPending ? (
					<div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
						<Loader2Icon className="size-4 animate-spin" /> Loading torrents…
					</div>
				) : items.length === 0 ? (
					<CloudEmpty
						text={search ? "No torrents match the filter." : "No torrents on this account."}
					/>
				) : (
					<div style={{ height: v.getTotalSize(), position: "relative" }}>
						{v.getVirtualItems().map((vi) => {
							const row = rows[vi.index]!;
							return (
								<div
									key={vi.key}
									ref={v.measureElement}
									data-index={vi.index}
									className="absolute inset-x-0"
									style={{ transform: `translateY(${vi.start}px)` }}
								>
									{row.type === "torrent" ? (
										<TorrentRow
											t={row.t}
											selected={selected.has(row.t.id)}
											expanded={expanded === row.t.id}
											onToggle={() => toggle(row.t.id)}
											onExpand={() => setExpanded(expanded === row.t.id ? null : row.t.id)}
										/>
									) : (
										<FilesPanel account={account} t={row.t} />
									)}
								</div>
							);
						})}
					</div>
				)}
				<LoadMore
					hasMore={!!q.hasNextPage}
					loading={q.isFetchingNextPage}
					onMore={() => q.fetchNextPage()}
					count={all.length}
				/>
			</div>
		</div>
	);
}

function TorrentRow({
	t,
	selected,
	expanded,
	onToggle,
	onExpand,
}: {
	t: CloudTorrent;
	selected: boolean;
	expanded: boolean;
	onToggle: () => void;
	onExpand: () => void;
}) {
	const st = statusOf(t.status);
	const done = t.status === "downloaded";
	return (
		<div
			onMouseDown={(e) =>
				e.button === 0 && !(e.target as HTMLElement).closest("button") && onToggle()
			}
			onDoubleClick={onExpand}
			className={cn(
				GRID,
				"h-9 border-b border-border/60 text-[13px] transition-colors",
				selected ? "bg-primary/10 hover:bg-primary/15" : "hover:bg-accent/60",
			)}
		>
			<div className="flex justify-center" onMouseDown={(e) => e.stopPropagation()}>
				<Checkbox checked={selected} onCheckedChange={onToggle} aria-label="Select" />
			</div>
			<div className="flex min-w-0 items-center gap-1.5 px-2">
				<button
					type="button"
					aria-label={expanded ? "Hide files" : "Show files"}
					onClick={onExpand}
					className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
				>
					<ChevronRightIcon
						className={cn("size-3.5 transition-transform", expanded && "rotate-90")}
					/>
				</button>
				<span className="truncate" title={t.name}>
					{t.name}
				</span>
			</div>
			<div className="px-2 text-right text-muted-foreground tabular-nums">{bytes(t.bytes)}</div>
			<div className="flex min-w-0 items-center gap-2 px-2">
				{done ? (
					<span className={st.tone}>{st.label}</span>
				) : (
					<>
						<Bar
							value={t.progress}
							tone="bg-warning"
							className="w-16 shrink-0"
							striped={t.status === "downloading"}
						/>
						<span className={cn("truncate text-[12px]", st.tone)}>
							{st.label}
							{t.status === "downloading" && ` ${Math.floor(t.progress)}%`}
						</span>
						{t.speed ? (
							<span className="shrink-0 text-[11px] text-muted-foreground">{speed(t.speed)}</span>
						) : null}
					</>
				)}
			</div>
			<div className="px-2 text-[12px] text-muted-foreground">{ago(t.addedAt)}</div>
		</div>
	);
}

function FilesPanel({ account, t }: { account: AccountPublic; t: CloudTorrent }) {
	const send = useSendToDownloads();
	const { data, isPending, error } = useQuery({
		queryKey: ["cloud", account.id, "files", t.id],
		queryFn: () => rpc.request.cloudTorrentFiles({ accountId: account.id, id: t.id }),
		retry: false,
	});
	const [picked, setPicked] = useState<Set<string>>(new Set());
	const files = data ?? [];
	const allPicked = files.length > 0 && picked.size === files.length;

	return (
		<div className="border-b bg-muted/30 py-2 pr-3 pl-10">
			{isPending ? (
				<p className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
					<Loader2Icon className="size-3.5 animate-spin" /> Loading files…
				</p>
			) : error ? (
				<p className="py-2 text-xs text-destructive">{errText(error)}</p>
			) : files.length === 0 ? (
				<p className="py-2 text-xs text-muted-foreground">No files listed yet.</p>
			) : (
				<>
					<div className="max-h-56 overflow-auto rounded-md border bg-background">
						{files.map((f) => (
							<label
								key={f.id}
								className="flex h-7 items-center gap-2 border-b border-border/50 px-2 text-[12.5px] last:border-0 hover:bg-accent/50"
							>
								<Checkbox
									checked={picked.has(f.id)}
									onCheckedChange={() =>
										setPicked((p) => {
											const n = new Set(p);
											if (n.has(f.id)) n.delete(f.id);
											else n.add(f.id);
											return n;
										})
									}
								/>
								<FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
								<span className="min-w-0 flex-1 truncate" title={f.path}>
									{f.path}
								</span>
								<span className="shrink-0 text-muted-foreground tabular-nums">
									{bytes(f.bytes)}
								</span>
							</label>
						))}
					</div>
					<div className="mt-2 flex items-center gap-2">
						<Button
							size="xs"
							variant="ghost"
							onClick={() => setPicked(allPicked ? new Set() : new Set(files.map((f) => f.id)))}
						>
							{allPicked ? "Select none" : "Select all"}
						</Button>
						<span className="text-xs text-muted-foreground">
							{files.length} file{files.length === 1 ? "" : "s"}
						</span>
						<Button
							size="xs"
							className="ml-auto"
							disabled={!picked.size}
							onClick={() =>
								void send(() =>
									rpc.request.cloudDownload({
										accountId: account.id,
										torrentId: t.id,
										name: t.name,
										fileIds: allPicked ? undefined : [...picked],
									}),
								)
							}
						>
							Download {picked.size || ""} selected
						</Button>
					</div>
				</>
			)}
		</div>
	);
}
