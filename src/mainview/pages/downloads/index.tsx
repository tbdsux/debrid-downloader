import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { toast } from "sonner";
import {
	ArrowDownCircleIcon,
	BrushCleaningIcon,
	CheckCircle2Icon,
	ClipboardPasteIcon,
	CopyIcon,
	DownloadIcon,
	FolderOpenIcon,
	HourglassIcon,
	LayersIcon,
	PauseCircleIcon,
	PauseIcon,
	PlayIcon,
	PlusIcon,
	RotateCcwIcon,
	SearchIcon,
	Trash2Icon,
	AlertCircleIcon,
	UploadIcon,
	XIcon,
	CloudOffIcon,
	ExternalLinkIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuShortcut,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { ProviderBadge, SectionTitle, ToolButton, ToolSep, Kbd } from "@/components/app-ui";
import { useConfirm } from "@/components/confirm";
import { fileToBase64, jobAction, taskAction, useJobs } from "@/lib/use-downloads";
import { useSettings, NO_ACCOUNTS } from "@/lib/use-settings";
import { tabFor, useOpenAdd } from "@/lib/add-dialog-context";
import { errText, rpc } from "@/lib/rpc";
import type { JobAction, JobPublic, JobStatus } from "../../../shared/rpc-schema";
import { HeaderRow, JobRow, TaskRow } from "./rows";

// ---------------------------------------------------------------- filters

type Filter = "all" | "active" | "service" | "paused" | "completed" | "failed";

const FILTERS: {
	id: Filter;
	label: string;
	icon: typeof LayersIcon;
	match: (s: JobStatus) => boolean;
}[] = [
	{ id: "all", label: "All", icon: LayersIcon, match: () => true },
	{
		id: "active",
		label: "Downloading",
		icon: ArrowDownCircleIcon,
		match: (s) => s === "downloading",
	},
	{
		id: "service",
		label: "On service",
		icon: HourglassIcon,
		match: (s) => s === "queued" || s === "submitting" || s === "remote" || s === "resolving",
	},
	{ id: "paused", label: "Paused", icon: PauseCircleIcon, match: (s) => s === "paused" },
	{ id: "completed", label: "Completed", icon: CheckCircle2Icon, match: (s) => s === "completed" },
	{ id: "failed", label: "Failed", icon: AlertCircleIcon, match: (s) => s === "failed" },
];

type Row = { type: "job"; job: JobPublic } | { type: "task"; job: JobPublic; index: number };

// Clipboard candidates the user already dismissed or added (per session).
const seenClipboard = new Set<string>();

export default function DownloadsPage() {
	const { data: jobs = [], isPending } = useJobs();
	const { data: settings } = useSettings();
	const accounts = settings?.accounts ?? NO_ACCOUNTS;
	const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
	const openAdd = useOpenAdd();
	const [confirm, confirmNode] = useConfirm();

	const [filter, setFilter] = useState<Filter>("all");
	const [accountFilter, setAccountFilter] = useState<string | null>(null);
	const [search, setSearch] = useState("");
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const anchor = useRef<string | null>(null);
	const [dragging, setDragging] = useState(false);
	const [clip, setClip] = useState<string | null>(null);

	// Newest first, like most download managers.
	const ordered = useMemo(
		() => [...jobs].sort((a, b) => b.addedAt.localeCompare(a.addedAt)),
		[jobs],
	);
	const counts = useMemo(() => {
		const c = Object.fromEntries(FILTERS.map((f) => [f.id, 0])) as Record<Filter, number>;
		for (const j of ordered) for (const f of FILTERS) if (f.match(j.status)) c[f.id]++;
		return c;
	}, [ordered]);

	const visible = useMemo(() => {
		const f = FILTERS.find((x) => x.id === filter)!;
		const q = search.trim().toLowerCase();
		return ordered.filter(
			(j) =>
				f.match(j.status) &&
				(!accountFilter || j.accountId === accountFilter) &&
				(!q || j.name.toLowerCase().includes(q)),
		);
	}, [ordered, filter, accountFilter, search]);

	const rows = useMemo<Row[]>(() => {
		const out: Row[] = [];
		for (const job of visible) {
			out.push({ type: "job", job });
			if (expanded.has(job.id) && job.tasks.length > 1) {
				job.tasks.forEach((_, index) => out.push({ type: "task", job, index }));
			}
		}
		return out;
	}, [visible, expanded]);

	// Drop selections that are no longer visible.
	useEffect(() => {
		setSelected((prev) => {
			const ids = new Set(visible.map((j) => j.id));
			const next = new Set([...prev].filter((id) => ids.has(id)));
			return next.size === prev.size ? prev : next;
		});
	}, [visible]);

	const selectedJobs = useMemo(
		() => visible.filter((j) => selected.has(j.id)),
		[visible, selected],
	);
	const ids = selectedJobs.map((j) => j.id);
	const can = {
		pause: selectedJobs.some((j) => !["paused", "completed", "failed"].includes(j.status)),
		resume: selectedJobs.some((j) => j.status === "paused"),
		retry: selectedJobs.some(
			(j) => j.status === "failed" || j.tasks.some((t) => t.status === "failed"),
		),
		remove: selectedJobs.length > 0,
	};

	// ------------------------------------------------------------ selection

	const onRowClick = useCallback(
		(e: MouseEvent, id: string) => {
			if (e.shiftKey && anchor.current) {
				const order = visible.map((j) => j.id);
				const a = order.indexOf(anchor.current);
				const b = order.indexOf(id);
				if (a >= 0 && b >= 0) {
					const [lo, hi] = a < b ? [a, b] : [b, a];
					setSelected(new Set(order.slice(lo, hi + 1)));
					return;
				}
			}
			anchor.current = id;
			if (e.ctrlKey || e.metaKey) {
				setSelected((prev) => {
					const next = new Set(prev);
					if (next.has(id)) next.delete(id);
					else next.add(id);
					return next;
				});
			} else {
				setSelected(new Set([id]));
			}
		},
		[visible],
	);

	const onToggle = useCallback((id: string) => {
		anchor.current = id;
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);

	const onExpand = useCallback((id: string) => {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);

	const onContext = useCallback((id: string) => {
		setSelected((prev) => (prev.has(id) ? prev : new Set([id])));
		anchor.current = id;
	}, []);

	const openJob = useCallback(
		(job: JobPublic) => {
			if (job.status === "completed") void rpc.request.openPath({ jobId: job.id });
			else if (job.tasks.length > 1) onExpand(job.id);
		},
		[onExpand],
	);

	const onTaskAction = useCallback(
		(jobId: string, taskId: string, action: "pause" | "resume" | "retry") =>
			void taskAction(jobId, [taskId], action),
		[],
	);
	const onTaskOpen = useCallback(
		(jobId: string, taskId: string, reveal?: boolean) =>
			void rpc.request.openPath({ jobId, taskId, reveal }),
		[],
	);

	// ------------------------------------------------------------ actions

	const run = useCallback(
		(action: JobAction, targets = ids) => {
			if (!targets.length) return;
			const n = targets.length;
			const what = `${n} download${n > 1 ? "s" : ""}`;
			if (action === "removeAndDelete") {
				confirm({
					title: `Remove ${what} and delete files?`,
					description: "Downloaded files are moved to the trash; partial files are deleted.",
					confirm: "Remove and delete",
					destructive: true,
					onConfirm: () => jobAction(targets, action),
				});
			} else if (action === "removeFromDebrid") {
				confirm({
					title: `Remove ${what} from the debrid account too?`,
					description: "The torrents are deleted from the service. Files already on disk are kept.",
					confirm: "Remove everywhere",
					destructive: true,
					onConfirm: () => jobAction(targets, action),
				});
			} else {
				void jobAction(targets, action);
			}
		},
		[ids, confirm],
	);

	const copyLinks = async () => {
		const job = selectedJobs[0];
		if (!job) return;
		try {
			const ok = await rpc.request.copyLink({ jobId: job.id });
			if (ok) toast.success("Link copied");
			else toast.info("No link to copy yet");
		} catch (err) {
			toast.error(errText(err));
		}
	};

	// ------------------------------------------------------------ keyboard / paste / drop

	const listRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const t = e.target as HTMLElement;
			if (t.closest("input, textarea, [role=dialog], [role=menu]")) return;
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
				e.preventDefault();
				setSelected(new Set(visible.map((j) => j.id)));
			} else if (e.key === "Escape") {
				setSelected(new Set());
			} else if (e.key === "Delete" && ids.length) {
				run(e.shiftKey ? "removeAndDelete" : "remove");
			} else if (e.key === " " && ids.length) {
				e.preventDefault();
				run(can.pause ? "pause" : "resume");
			} else if (e.key === "Enter" && selectedJobs[0]) {
				openJob(selectedJobs[0]);
			}
		};
		const onPaste = (e: ClipboardEvent) => {
			const t = e.target as HTMLElement;
			if (t.closest("input, textarea, [role=dialog]")) return;
			const text = e.clipboardData?.getData("text/plain")?.trim();
			if (text) openAdd({ tab: tabFor(text), text });
		};
		window.addEventListener("keydown", onKey);
		window.addEventListener("paste", onPaste);
		return () => {
			window.removeEventListener("keydown", onKey);
			window.removeEventListener("paste", onPaste);
		};
	}, [visible, ids, run, can.pause, selectedJobs, openJob, openAdd]);

	// Clipboard detection: offer to add a magnet/link found on focus.
	const clipboardOn = settings?.general.clipboard ?? false;
	useEffect(() => {
		if (!clipboardOn) {
			setClip(null);
			return;
		}
		const check = async () => {
			try {
				const c = await rpc.request.readClipboardCandidate();
				setClip(c && !seenClipboard.has(c) ? c : null);
			} catch {
				/* ignore */
			}
		};
		void check();
		window.addEventListener("focus", check);
		return () => window.removeEventListener("focus", check);
	}, [clipboardOn]);

	async function onDrop(e: React.DragEvent) {
		e.preventDefault();
		setDragging(false);
		const torrents = [...e.dataTransfer.files].filter((f) =>
			f.name.toLowerCase().endsWith(".torrent"),
		);
		if (torrents.length) {
			const files = await Promise.all(
				torrents.map(async (f) => ({ name: f.name, base64: await fileToBase64(f) })),
			);
			openAdd({ tab: "torrent", files });
			return;
		}
		const text = e.dataTransfer.getData("text/plain")?.trim();
		if (text) openAdd({ tab: tabFor(text), text });
	}

	// ------------------------------------------------------------ virtual list

	const virtualizer = useVirtualizer({
		count: rows.length,
		getScrollElement: () => listRef.current,
		estimateSize: (i) => (rows[i]?.type === "task" ? 30 : 36),
		overscan: 12,
		getItemKey: (i) => {
			const r = rows[i]!;
			return r.type === "job" ? r.job.id : `${r.job.id}:${r.index}`;
		},
	});

	const allSelected = visible.length > 0 && selected.size === visible.length;

	return (
		<div className="flex h-full min-h-0">
			{/* ---------------------------------------------------- sidebar */}
			<aside className="flex w-52 shrink-0 flex-col border-r bg-chrome/60">
				<SectionTitle>Status</SectionTitle>
				<nav className="flex flex-col gap-px px-2">
					{FILTERS.map((f) => (
						<SideItem
							key={f.id}
							active={filter === f.id}
							onClick={() => setFilter(f.id)}
							icon={
								<f.icon
									className={cn(f.id === "failed" && counts.failed > 0 && "text-destructive")}
								/>
							}
							label={f.label}
							count={counts[f.id]}
						/>
					))}
				</nav>
				{accounts.length > 0 && (
					<>
						<SectionTitle
							action={
								accountFilter && (
									<button
										type="button"
										onClick={() => setAccountFilter(null)}
										className="text-[11px] text-primary hover:underline"
									>
										Clear
									</button>
								)
							}
						>
							Accounts
						</SectionTitle>
						<nav className="flex flex-col gap-px overflow-auto px-2 pb-2">
							{accounts.map((a) => (
								<SideItem
									key={a.id}
									active={accountFilter === a.id}
									onClick={() => setAccountFilter(accountFilter === a.id ? null : a.id)}
									icon={<ProviderBadge provider={a.provider} />}
									label={a.label}
									count={ordered.filter((j) => j.accountId === a.id).length}
									warn={a.status === "invalid"}
								/>
							))}
						</nav>
					</>
				)}
				<dl className="mt-auto grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1 border-t p-3 text-[11px] text-muted-foreground">
					<dt>
						<Kbd>Ctrl+N</Kbd>
					</dt>
					<dd>Add downloads</dd>
					<dt>
						<Kbd>Ctrl+V</Kbd>
					</dt>
					<dd>Paste magnet / link</dd>
					<dt>
						<Kbd>Space</Kbd>
					</dt>
					<dd>Pause / resume</dd>
					<dt>
						<Kbd>Del</Kbd>
					</dt>
					<dd>Remove</dd>
				</dl>
			</aside>

			{/* ---------------------------------------------------- main */}
			<section
				className="relative flex min-w-0 flex-1 flex-col"
				onDragOver={(e) => {
					if (
						e.dataTransfer.types.includes("Files") ||
						e.dataTransfer.types.includes("text/plain")
					) {
						e.preventDefault();
						setDragging(true);
					}
				}}
				onDragLeave={(e) => {
					if (e.currentTarget === e.target) setDragging(false);
				}}
				onDrop={onDrop}
			>
				<div className="flex h-11 shrink-0 items-center gap-0.5 border-b px-2">
					<ToolButton
						tone="primary"
						icon={<PlusIcon />}
						label="Add"
						tip="Add magnet, torrent or links (Ctrl+N)"
						onClick={() => openAdd()}
					/>
					<ToolSep />
					<ToolButton
						icon={<PlayIcon />}
						label="Resume"
						disabled={!can.resume}
						onClick={() => run("resume")}
					/>
					<ToolButton
						icon={<PauseIcon />}
						label="Pause"
						disabled={!can.pause}
						onClick={() => run("pause")}
					/>
					<ToolButton
						icon={<RotateCcwIcon />}
						label="Retry"
						disabled={!can.retry}
						onClick={() => run("retry")}
					/>
					<ToolSep />
					<ToolButton
						icon={<Trash2Icon />}
						label="Remove"
						tone="danger"
						disabled={!can.remove}
						tip="Remove from list (Del) — Shift+Del also deletes files"
						onClick={() => run("remove")}
					/>
					<ToolButton
						icon={<FolderOpenIcon />}
						label="Open folder"
						showLabel={false}
						tip="Open folder"
						disabled={selectedJobs.length !== 1}
						onClick={() =>
							selectedJobs[0] && rpc.request.openPath({ jobId: selectedJobs[0].id, reveal: true })
						}
					/>
					<ToolButton
						icon={<BrushCleaningIcon />}
						label="Clear completed"
						showLabel={false}
						tip="Clear completed from the list"
						disabled={!counts.completed}
						onClick={() => void rpc.request.clearCompleted()}
					/>
					<div className="ml-auto flex items-center gap-2">
						{selectedJobs.length > 0 && (
							<span className="text-xs text-muted-foreground tabular-nums">
								{selectedJobs.length} selected
							</span>
						)}
						<div className="relative">
							<SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
							<Input
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								placeholder="Filter by name"
								className="h-7 w-52 pl-7 text-[13px]"
							/>
							{search && (
								<button
									type="button"
									aria-label="Clear filter"
									onClick={() => setSearch("")}
									className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
								>
									<XIcon className="size-3" />
								</button>
							)}
						</div>
					</div>
				</div>

				{clip && (
					<div className="flex shrink-0 items-center gap-3 border-b bg-primary/5 px-3 py-1.5 text-[13px]">
						<ClipboardPasteIcon className="size-4 shrink-0 text-primary" />
						<span className="shrink-0 text-muted-foreground">On your clipboard:</span>
						<span className="min-w-0 flex-1 truncate font-mono text-xs" title={clip}>
							{clip}
						</span>
						<Button
							size="xs"
							onClick={() => {
								seenClipboard.add(clip);
								openAdd({ tab: tabFor(clip), text: clip });
								setClip(null);
							}}
						>
							Add
						</Button>
						<Button
							size="xs"
							variant="ghost"
							onClick={() => {
								seenClipboard.add(clip);
								setClip(null);
							}}
						>
							Dismiss
						</Button>
					</div>
				)}

				<ContextMenu>
					<ContextMenuTrigger className="flex min-h-0 flex-1 flex-col">
						<div ref={listRef} className="min-h-0 flex-1 overflow-auto outline-none" tabIndex={-1}>
							<div className="min-w-[860px]">
								<HeaderRow
									allSelected={allSelected}
									someSelected={selected.size > 0}
									onToggleAll={() =>
										setSelected(allSelected ? new Set() : new Set(visible.map((j) => j.id)))
									}
								/>
								{rows.length > 0 && (
									<div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
										{virtualizer.getVirtualItems().map((v) => {
											const row = rows[v.index]!;
											return (
												<div
													key={v.key}
													style={{
														position: "absolute",
														top: 0,
														left: 0,
														right: 0,
														transform: `translateY(${v.start}px)`,
													}}
												>
													{row.type === "job" ? (
														<JobRow
															job={row.job}
															account={accountById.get(row.job.accountId)}
															selected={selected.has(row.job.id)}
															expanded={expanded.has(row.job.id)}
															onRowClick={onRowClick}
															onToggle={onToggle}
															onExpand={onExpand}
															onOpen={openJob}
															onContext={onContext}
														/>
													) : (
														<TaskRow
															jobId={row.job.id}
															task={row.job.tasks[row.index]!}
															onAction={onTaskAction}
															onOpen={onTaskOpen}
														/>
													)}
												</div>
											);
										})}
									</div>
								)}
							</div>
							{!isPending && rows.length === 0 && (
								<EmptyState
									hasAny={jobs.length > 0}
									hasAccounts={accounts.length > 0}
									onAdd={() => openAdd()}
									onClear={() => {
										setFilter("all");
										setAccountFilter(null);
										setSearch("");
									}}
								/>
							)}
						</div>
					</ContextMenuTrigger>
					<ContextMenuContent className="min-w-52">
						{selectedJobs.length === 0 ? (
							<ContextMenuItem onClick={() => openAdd()}>
								<PlusIcon /> Add downloads…
								<ContextMenuShortcut>Ctrl+N</ContextMenuShortcut>
							</ContextMenuItem>
						) : (
							<>
								<ContextMenuItem disabled={!can.resume} onClick={() => run("resume")}>
									<PlayIcon /> Resume
								</ContextMenuItem>
								<ContextMenuItem disabled={!can.pause} onClick={() => run("pause")}>
									<PauseIcon /> Pause
									<ContextMenuShortcut>Space</ContextMenuShortcut>
								</ContextMenuItem>
								<ContextMenuItem disabled={!can.retry} onClick={() => run("retry")}>
									<RotateCcwIcon /> Retry
								</ContextMenuItem>
								<ContextMenuSeparator />
								<ContextMenuItem
									disabled={selectedJobs.length !== 1 || selectedJobs[0]?.status !== "completed"}
									onClick={() => selectedJobs[0] && openJob(selectedJobs[0])}
								>
									<ExternalLinkIcon /> Open
									<ContextMenuShortcut>Enter</ContextMenuShortcut>
								</ContextMenuItem>
								<ContextMenuItem
									disabled={selectedJobs.length !== 1}
									onClick={() =>
										selectedJobs[0] &&
										rpc.request.openPath({ jobId: selectedJobs[0].id, reveal: true })
									}
								>
									<FolderOpenIcon /> Show in folder
								</ContextMenuItem>
								<ContextMenuItem disabled={selectedJobs.length !== 1} onClick={copyLinks}>
									<CopyIcon /> Copy download link
								</ContextMenuItem>
								<ContextMenuSeparator />
								<ContextMenuItem onClick={() => run("remove")}>
									<XIcon /> Remove from list
									<ContextMenuShortcut>Del</ContextMenuShortcut>
								</ContextMenuItem>
								<ContextMenuItem variant="destructive" onClick={() => run("removeAndDelete")}>
									<Trash2Icon /> Remove and delete files
									<ContextMenuShortcut>⇧Del</ContextMenuShortcut>
								</ContextMenuItem>
								<ContextMenuItem
									variant="destructive"
									disabled={!selectedJobs.some((j) => j.kind !== "link")}
									onClick={() => run("removeFromDebrid")}
								>
									<CloudOffIcon /> Remove from debrid account
								</ContextMenuItem>
							</>
						)}
					</ContextMenuContent>
				</ContextMenu>

				{dragging && (
					<div className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary bg-background/85 backdrop-blur-sm">
						<UploadIcon className="size-8 text-primary" />
						<p className="text-sm font-medium">Drop .torrent files, magnets or links</p>
					</div>
				)}
			</section>
			{confirmNode}
		</div>
	);
}

function SideItem({
	active,
	onClick,
	icon,
	label,
	count,
	warn,
}: {
	active: boolean;
	onClick: () => void;
	icon: React.ReactNode;
	label: string;
	count: number;
	warn?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"flex h-7 items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors [&_svg]:size-4 [&_svg]:shrink-0",
				active
					? "bg-primary/12 font-medium text-foreground [&_svg]:text-primary"
					: "text-foreground/80 hover:bg-accent [&_svg]:text-muted-foreground",
			)}
		>
			{icon}
			<span className={cn("min-w-0 flex-1 truncate", warn && "text-destructive")}>{label}</span>
			{count > 0 && <span className="text-[11px] text-muted-foreground tabular-nums">{count}</span>}
		</button>
	);
}

function EmptyState({
	hasAny,
	hasAccounts,
	onAdd,
	onClear,
}: {
	hasAny: boolean;
	hasAccounts: boolean;
	onAdd: () => void;
	onClear: () => void;
}) {
	if (hasAny) {
		return (
			<Empty className="py-16">
				<EmptyHeader>
					<EmptyTitle>Nothing matches</EmptyTitle>
					<EmptyDescription>No downloads match the current filter.</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button size="sm" variant="outline" onClick={onClear}>
						Show all
					</Button>
				</EmptyContent>
			</Empty>
		);
	}
	return (
		<Empty className="py-16">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<DownloadIcon />
				</EmptyMedia>
				<EmptyTitle>No downloads yet</EmptyTitle>
				<EmptyDescription>
					{hasAccounts
						? "Add a magnet, a .torrent file or hoster links. You can also paste with Ctrl+V or drop .torrent files here."
						: "Link a debrid account in Settings, then add a magnet, .torrent or link."}
				</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				{hasAccounts ? (
					<Button size="sm" onClick={onAdd}>
						<PlusIcon /> Add downloads
					</Button>
				) : (
					<a href="#/settings" className="text-sm text-primary hover:underline">
						Open Settings → Accounts
					</a>
				)}
			</EmptyContent>
		</Empty>
	);
}
