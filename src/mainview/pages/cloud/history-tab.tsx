import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Loader2Icon, LinkIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { ago, bytes } from "@/lib/format";
import { rpc } from "@/lib/rpc";
import type { AccountPublic } from "../../../shared/rpc-schema";
import { CloudEmpty, CloudError, LoadMore, useSendToDownloads, type TabApi } from "./shared";

const PAGE = 100;
const GRID = "grid grid-cols-[32px_minmax(220px,1fr)_140px_88px_110px] items-center";

/** Link history (RD /downloads, AD saved history) — re-download via the hoster link. */
export function HistoryTab({
	account,
	search,
	onApi,
}: {
	account: AccountPublic;
	search: string;
	onApi: (api: TabApi) => void;
}) {
	const send = useSendToDownloads();
	const q = useInfiniteQuery({
		queryKey: ["cloud", account.id, "history"],
		queryFn: ({ pageParam }) =>
			rpc.request.cloudHistory({ accountId: account.id, offset: pageParam, limit: PAGE }),
		initialPageParam: 0,
		getNextPageParam: (last, pages) => (last.hasMore ? pages.length * PAGE : undefined),
		retry: false,
	});
	const all = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
	const items = useMemo(() => {
		const s = search.trim().toLowerCase();
		return s ? all.filter((l) => l.filename.toLowerCase().includes(s) || l.host?.includes(s)) : all;
	}, [all, search]);
	const [selected, setSelected] = useState<Set<string>>(new Set());

	useEffect(() => {
		const chosen = all.filter((l) => selected.has(l.id));
		onApi({
			selectedCount: chosen.length,
			download: () =>
				void send(async () => {
					const jobs = await rpc.request.addJobs({
						kind: "link",
						inputs: chosen.map((l) => l.link),
						accountId: account.id,
					});
					setSelected(new Set());
					return jobs;
				}),
		});
	}, [selected, all, account, onApi, send]);

	if (q.error) return <CloudError error={q.error} onRetry={() => q.refetch()} />;
	const allSel = items.length > 0 && items.every((l) => selected.has(l.id));
	const toggle = (id: string) =>
		setSelected((prev) => {
			const n = new Set(prev);
			if (n.has(id)) n.delete(id);
			else n.add(id);
			return n;
		});

	return (
		<div className="h-full overflow-auto">
			<div className="min-w-[640px]">
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
								setSelected(allSel ? new Set() : new Set(items.map((l) => l.id)))
							}
							aria-label="Select all"
						/>
					</div>
					<div className="px-2">File</div>
					<div className="px-2">Host</div>
					<div className="px-2 text-right">Size</div>
					<div className="px-2">Generated</div>
				</div>
				{q.isPending ? (
					<div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
						<Loader2Icon className="size-4 animate-spin" /> Loading history…
					</div>
				) : items.length === 0 ? (
					<CloudEmpty
						text={search ? "Nothing matches the filter." : "No download history on this account."}
					/>
				) : (
					items.map((l) => (
						<div
							key={l.id}
							onMouseDown={(e) => e.button === 0 && toggle(l.id)}
							className={cn(
								GRID,
								"h-9 border-b border-border/60 text-[13px] transition-colors",
								selected.has(l.id) ? "bg-primary/10 hover:bg-primary/15" : "hover:bg-accent/60",
							)}
						>
							<div className="flex justify-center" onMouseDown={(e) => e.stopPropagation()}>
								<Checkbox checked={selected.has(l.id)} onCheckedChange={() => toggle(l.id)} />
							</div>
							<div className="flex min-w-0 items-center gap-2 px-2">
								<LinkIcon className="size-3.5 shrink-0 text-muted-foreground" />
								<span className="truncate" title={l.filename}>
									{l.filename}
								</span>
							</div>
							<div className="truncate px-2 text-[12px] text-muted-foreground">{l.host}</div>
							<div className="px-2 text-right text-muted-foreground tabular-nums">
								{bytes(l.bytes)}
							</div>
							<div className="px-2 text-[12px] text-muted-foreground">{ago(l.addedAt)}</div>
						</div>
					))
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
