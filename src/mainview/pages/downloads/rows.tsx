// Row renderers for the downloads list (job rows + expandable file rows).
// A CSS grid (not <table>) so rows can be virtualized and share one context menu.
import { memo, type MouseEvent } from "react";
import {
	AlertCircleIcon,
	CheckCircle2Icon,
	ChevronRightIcon,
	CloudIcon,
	FileIcon,
	FolderOpenIcon,
	HourglassIcon,
	LinkIcon,
	Loader2Icon,
	MagnetIcon,
	PauseCircleIcon,
	PauseIcon,
	PlayIcon,
	RotateCcwIcon,
	ArrowDownCircleIcon,
	ClockIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { AccountName, Bar } from "@/components/app-ui";
import {
	STATUS_BAR,
	STATUS_TONE,
	bytes,
	eta,
	jobProgress,
	pct,
	speed,
	statusText,
} from "@/lib/format";
import type {
	AccountPublic,
	FileTaskPublic,
	JobKind,
	JobPublic,
	JobStatus,
	TaskStatus,
} from "../../../shared/rpc-schema";

export const GRID =
	"grid grid-cols-[32px_minmax(200px,1fr)_80px_minmax(120px,170px)_minmax(130px,180px)_84px_64px_minmax(96px,140px)] items-center";

const KIND_ICON: Record<JobKind, typeof FileIcon> = {
	magnet: MagnetIcon,
	torrent: FileIcon,
	link: LinkIcon,
	cloud: CloudIcon,
};

const STATUS_ICON: Record<JobStatus, typeof FileIcon> = {
	queued: ClockIcon,
	submitting: Loader2Icon,
	remote: HourglassIcon,
	resolving: Loader2Icon,
	downloading: ArrowDownCircleIcon,
	paused: PauseCircleIcon,
	completed: CheckCircle2Icon,
	failed: AlertCircleIcon,
};

export function HeaderRow({
	allSelected,
	someSelected,
	onToggleAll,
}: {
	allSelected: boolean;
	someSelected: boolean;
	onToggleAll: () => void;
}) {
	return (
		<div
			className={cn(
				GRID,
				"sticky top-0 z-10 h-8 border-b bg-chrome/95 text-[11.5px] font-medium text-muted-foreground backdrop-blur",
			)}
		>
			<div className="flex justify-center">
				<Checkbox
					checked={allSelected}
					indeterminate={someSelected && !allSelected}
					onCheckedChange={onToggleAll}
					aria-label="Select all"
				/>
			</div>
			<div className="px-2">Name</div>
			<div className="px-2 text-right">Size</div>
			<div className="px-2">Progress</div>
			<div className="px-2">Status</div>
			<div className="px-2 text-right">Speed</div>
			<div className="px-2 text-right">ETA</div>
			<div className="px-2">Account</div>
		</div>
	);
}

type JobRowProps = {
	job: JobPublic;
	account?: AccountPublic;
	selected: boolean;
	expanded: boolean;
	onRowClick: (e: MouseEvent, id: string) => void;
	onToggle: (id: string) => void;
	onExpand: (id: string) => void;
	onOpen: (job: JobPublic) => void;
	onContext: (id: string) => void;
};

export const JobRow = memo(function JobRow({
	job,
	account,
	selected,
	expanded,
	onRowClick,
	onToggle,
	onExpand,
	onOpen,
	onContext,
}: JobRowProps) {
	const KindIcon = KIND_ICON[job.kind];
	const StatusIcon = STATUS_ICON[job.status];
	const progress = jobProgress(job);
	const isRemote =
		job.status === "remote" || job.status === "submitting" || job.status === "resolving";
	const multi = job.tasks.length > 1;
	const spinning = job.status === "submitting" || job.status === "resolving";

	return (
		<div
			role="row"
			aria-selected={selected}
			onMouseDown={(e) => {
				if (e.button === 0) onRowClick(e, job.id);
			}}
			onDoubleClick={() => onOpen(job)}
			onContextMenu={() => onContext(job.id)}
			className={cn(
				GRID,
				"group h-9 border-b border-border/60 text-[13px] transition-colors",
				selected ? "bg-primary/10 hover:bg-primary/15" : "hover:bg-accent/60",
			)}
		>
			<div className="flex justify-center" onMouseDown={(e) => e.stopPropagation()}>
				<Checkbox checked={selected} onCheckedChange={() => onToggle(job.id)} aria-label="Select" />
			</div>
			<div className="flex min-w-0 items-center gap-1.5 px-2">
				<button
					type="button"
					aria-label={expanded ? "Collapse" : "Expand"}
					onMouseDown={(e) => e.stopPropagation()}
					onClick={() => multi && onExpand(job.id)}
					className={cn(
						"flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground",
						!multi && "invisible",
					)}
				>
					<ChevronRightIcon
						className={cn("size-3.5 transition-transform", expanded && "rotate-90")}
					/>
				</button>
				<KindIcon className="size-4 shrink-0 text-muted-foreground" />
				<span className="truncate" title={job.name}>
					{job.name}
				</span>
				{multi && (
					<span className="shrink-0 rounded bg-muted px-1 text-[10.5px] text-muted-foreground tabular-nums">
						{job.tasks.length} files
					</span>
				)}
			</div>
			<div className="px-2 text-right text-muted-foreground tabular-nums">
				{bytes(job.bytesTotal)}
			</div>
			<div className="flex items-center gap-2 px-2">
				<Bar value={progress} tone={STATUS_BAR[job.status]} striped={job.status === "remote"} />
				<span className="w-9 shrink-0 text-right text-[11.5px] text-muted-foreground tabular-nums">
					{Math.floor(progress)}%
				</span>
			</div>
			<div
				className={cn("flex min-w-0 items-center gap-1.5 px-2", STATUS_TONE[job.status])}
				title={job.error ?? undefined}
			>
				<StatusIcon className={cn("size-3.5 shrink-0", spinning && "animate-spin")} />
				<span className="truncate">
					{job.status === "failed" && job.error ? job.error : statusText(job)}
				</span>
				{job.status === "remote" && job.remote?.seeders != null && (
					<span className="shrink-0 text-[11px] text-muted-foreground">
						· {job.remote.seeders} seeds
					</span>
				)}
			</div>
			<div className="px-2 text-right tabular-nums">
				{isRemote ? (
					<span className="text-[11.5px] text-muted-foreground">{speed(job.remote?.speed)}</span>
				) : (
					speed(job.speed)
				)}
			</div>
			<div className="px-2 text-right text-muted-foreground tabular-nums">
				{job.status === "downloading" ? eta(job.bytesTotal - job.bytesDone, job.speed) : ""}
			</div>
			<div className="min-w-0 px-2 text-[12.5px]">
				<AccountName account={account} />
			</div>
		</div>
	);
});

const TASK_TONE: Record<TaskStatus, string> = {
	queued: "text-muted-foreground",
	active: "text-primary",
	paused: "text-muted-foreground",
	completed: "text-success",
	failed: "text-destructive",
};
const TASK_BAR: Record<TaskStatus, string> = {
	queued: "bg-muted-foreground/40",
	active: "bg-primary",
	paused: "bg-muted-foreground/50",
	completed: "bg-success",
	failed: "bg-destructive",
};
const TASK_LABEL: Record<TaskStatus, string> = {
	queued: "Queued",
	active: "Downloading",
	paused: "Paused",
	completed: "Completed",
	failed: "Failed",
};

export const TaskRow = memo(function TaskRow({
	jobId,
	task,
	onAction,
	onOpen,
}: {
	jobId: string;
	task: FileTaskPublic;
	onAction: (jobId: string, taskId: string, action: "pause" | "resume" | "retry") => void;
	onOpen: (jobId: string, taskId: string, reveal?: boolean) => void;
}) {
	const progress = task.status === "completed" ? 100 : pct(task.bytesDone, task.bytesTotal);
	const label =
		task.status === "queued" && task.error
			? task.error
			: task.status === "failed"
				? task.error
				: TASK_LABEL[task.status];
	return (
		<div
			className={cn(GRID, "group h-[30px] border-b border-border/40 bg-muted/25 text-[12.5px]")}
			onDoubleClick={() => task.status === "completed" && onOpen(jobId, task.id)}
		>
			<div />
			<div className="flex min-w-0 items-center gap-1.5 pr-2 pl-9">
				<FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
				<span className="truncate text-foreground/85" title={task.name}>
					{task.name}
				</span>
				{!task.resumable && (
					<span
						title="This server doesn't support resuming — pausing restarts the file"
						className="shrink-0 rounded bg-warning/15 px-1 text-[10px] text-warning"
					>
						no resume
					</span>
				)}
			</div>
			<div className="px-2 text-right text-muted-foreground tabular-nums">
				{bytes(task.bytesTotal)}
			</div>
			<div className="flex items-center gap-2 px-2">
				<Bar value={progress} tone={TASK_BAR[task.status]} className="h-1" />
				<span className="w-9 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
					{Math.floor(progress)}%
				</span>
			</div>
			<div className={cn("truncate px-2", TASK_TONE[task.status])} title={task.error}>
				{label}
			</div>
			<div className="px-2 text-right tabular-nums">{speed(task.speed)}</div>
			<div className="px-2 text-right text-muted-foreground tabular-nums">
				{task.status === "active" ? eta(task.bytesTotal - task.bytesDone, task.speed) : ""}
			</div>
			<div className="flex items-center gap-0.5 px-2 opacity-0 transition-opacity group-hover:opacity-100">
				{(task.status === "active" || task.status === "queued") && (
					<MiniButton label="Pause" onClick={() => onAction(jobId, task.id, "pause")}>
						<PauseIcon />
					</MiniButton>
				)}
				{task.status === "paused" && (
					<MiniButton label="Resume" onClick={() => onAction(jobId, task.id, "resume")}>
						<PlayIcon />
					</MiniButton>
				)}
				{task.status === "failed" && (
					<MiniButton label="Retry" onClick={() => onAction(jobId, task.id, "retry")}>
						<RotateCcwIcon />
					</MiniButton>
				)}
				{task.status === "completed" && (
					<MiniButton label="Show in folder" onClick={() => onOpen(jobId, task.id, true)}>
						<FolderOpenIcon />
					</MiniButton>
				)}
			</div>
		</div>
	);
});

function MiniButton({
	label,
	onClick,
	children,
}: {
	label: string;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			title={label}
			aria-label={label}
			onClick={onClick}
			className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-3.5"
		>
			{children}
		</button>
	);
}
