import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	BadgeCheckIcon,
	CloudIcon,
	DownloadIcon,
	FolderIcon,
	HistoryIcon,
	ListTreeIcon,
	RefreshCwIcon,
	SearchIcon,
	Trash2Icon,
	TriangleAlertIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { AccountSelect, ToolButton, ToolSep } from "@/components/app-ui";
import { useConfirm } from "@/components/confirm";
import { useSettings, NO_ACCOUNTS } from "@/lib/use-settings";
import { errText, rpc } from "@/lib/rpc";
import { PROVIDERS, type AccountPublic } from "../../../shared/rpc-schema";
import { TorrentsTab } from "./torrents-tab";
import { HistoryTab } from "./history-tab";
import { FilesTab } from "./files-tab";
import type { TabApi } from "./shared";

export type CloudTab = "torrents" | "history" | "files";

const LAST_ACCOUNT_KEY = "cloud.account";
function readLast(): string | null {
	try {
		return localStorage.getItem(LAST_ACCOUNT_KEY);
	} catch {
		return null;
	}
}
function writeLast(id: string) {
	try {
		localStorage.setItem(LAST_ACCOUNT_KEY, id);
	} catch {
		/* storage unavailable */
	}
}

export default function CloudPage() {
	const { data: settings } = useSettings();
	const accounts = settings?.accounts ?? NO_ACCOUNTS;
	const [accountId, setAccountId] = useState<string | null>(null);
	const [tab, setTab] = useState<CloudTab>("torrents");
	const [search, setSearch] = useState("");
	const [api, setApi] = useState<TabApi>({ selectedCount: 0, download: () => {} });
	const [confirm, confirmNode] = useConfirm();
	const qc = useQueryClient();

	// Pick last-used, else default, else first account.
	useEffect(() => {
		if (!accounts.length) return;
		if (accountId && accounts.some((a) => a.id === accountId)) return;
		const last = readLast();
		const pick =
			accounts.find((a) => a.id === last) ?? accounts.find((a) => a.isDefault) ?? accounts[0]!;
		setAccountId(pick.id);
	}, [accounts, accountId]);

	const account = accounts.find((a) => a.id === accountId);
	const caps = account ? PROVIDERS[account.provider].caps : undefined;
	const tabs = useMemo(
		() =>
			[
				{ id: "torrents" as const, label: "Torrents", icon: ListTreeIcon, show: true },
				{ id: "history" as const, label: "Downloads", icon: HistoryIcon, show: !!caps?.history },
				{ id: "files" as const, label: "My files", icon: FolderIcon, show: !!caps?.files },
			].filter((t) => t.show),
		[caps],
	);
	useEffect(() => {
		if (!tabs.some((t) => t.id === tab)) setTab("torrents");
	}, [tabs, tab]);

	if (!settings) return null;
	if (!accounts.length || !account) {
		return (
			<Empty className="h-full">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<CloudIcon />
					</EmptyMedia>
					<EmptyTitle>No debrid accounts</EmptyTitle>
					<EmptyDescription>
						Link a Real-Debrid, AllDebrid or Premiumize account to browse what's already in your
						cloud.
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Link href="/settings" className="text-sm text-primary hover:underline">
						Open Settings → Accounts
					</Link>
				</EmptyContent>
			</Empty>
		);
	}

	const refresh = () => qc.invalidateQueries({ queryKey: ["cloud", account.id] });

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex h-12 shrink-0 items-center gap-3 border-b bg-chrome/60 px-3">
				<AccountSelect
					accounts={accounts}
					value={account.id}
					onChange={(id) => {
						setAccountId(id);
						writeLast(id);
					}}
				/>
				<AccountInfo account={account} />
				<div className="ml-auto flex items-center rounded-lg bg-muted p-0.5">
					{tabs.map((t) => (
						<button
							key={t.id}
							type="button"
							onClick={() => setTab(t.id)}
							className={cn(
								"flex h-7 items-center gap-1.5 rounded-md px-3 text-[13px] transition-colors [&_svg]:size-3.5",
								tab === t.id
									? "bg-background font-medium text-foreground shadow-sm"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							<t.icon />
							{t.label}
						</button>
					))}
				</div>
			</div>

			<div className="flex h-11 shrink-0 items-center gap-0.5 border-b px-2">
				<ToolButton
					tone="primary"
					icon={<DownloadIcon />}
					label={api.selectedCount ? `Download (${api.selectedCount})` : "Download"}
					disabled={!api.selectedCount}
					tip="Send selected to Downloads"
					onClick={api.download}
				/>
				{api.remove && (
					<ToolButton
						icon={<Trash2Icon />}
						label="Delete"
						tone="danger"
						disabled={!api.selectedCount}
						tip="Delete from the debrid account"
						onClick={() =>
							confirm({
								title: `Delete ${api.selectedCount} item${api.selectedCount === 1 ? "" : "s"} from ${account.label}?`,
								description: `They're removed from your ${PROVIDERS[account.provider].name} account. This can't be undone.`,
								confirm: "Delete",
								destructive: true,
								onConfirm: () => api.remove?.(),
							})
						}
					/>
				)}
				<ToolSep />
				<ToolButton icon={<RefreshCwIcon />} label="Refresh" onClick={refresh} />
				<div className="relative ml-auto">
					<SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
					<Input
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder="Filter loaded items"
						className="h-7 w-56 pl-7 text-[13px]"
					/>
				</div>
			</div>

			<div className="min-h-0 flex-1">
				{tab === "torrents" && (
					<TorrentsTab key={account.id} account={account} search={search} onApi={setApi} />
				)}
				{tab === "history" && (
					<HistoryTab key={account.id} account={account} search={search} onApi={setApi} />
				)}
				{tab === "files" && (
					<FilesTab key={account.id} account={account} search={search} onApi={setApi} />
				)}
			</div>
			{confirmNode}
		</div>
	);
}

function AccountInfo({ account }: { account: AccountPublic }) {
	const { data, error, isFetching } = useQuery({
		queryKey: ["cloud", account.id, "info"],
		queryFn: () => rpc.request.cloudAccountInfo({ accountId: account.id }),
		staleTime: 60_000,
		retry: false,
	});
	if (error || account.status === "invalid") {
		return (
			<span className="flex items-center gap-1.5 text-[12.5px] text-destructive">
				<TriangleAlertIcon className="size-3.5" />
				{account.status === "invalid" ? "Sign-in no longer valid" : errText(error)}
				<Link href="/settings" className="underline">
					Fix
				</Link>
			</span>
		);
	}
	if (!data)
		return (
			<span className="text-[12.5px] text-muted-foreground">{isFetching ? "Loading…" : ""}</span>
		);
	const expires = data.expiresAt ? new Date(data.expiresAt) : null;
	const days = expires ? Math.ceil((expires.getTime() - Date.now()) / 86_400_000) : null;
	return (
		<span className="flex min-w-0 items-center gap-2 text-[12.5px] text-muted-foreground">
			<span className="truncate text-foreground">{data.username}</span>
			{data.premium ? (
				<span
					className={cn(
						"flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px]",
						days != null && days < 7 ? "bg-warning/15 text-warning" : "bg-success/12 text-success",
					)}
				>
					<BadgeCheckIcon className="size-3" />
					Premium{expires ? ` · ${days} day${days === 1 ? "" : "s"} left` : ""}
				</span>
			) : (
				<span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px]">Free</span>
			)}
		</span>
	);
}
