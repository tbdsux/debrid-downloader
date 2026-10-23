import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Route, Switch, Link, Router, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { useQuery } from "@tanstack/react-query";
import {
	ArrowDownIcon,
	CloudIcon,
	DownloadIcon,
	HardDriveIcon,
	HourglassIcon,
	SettingsIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import DownloadsPage from "@/pages/downloads";
import CloudPage from "@/pages/cloud";
import SettingsPage from "@/pages/settings";
import { AddDialog } from "@/pages/downloads/add-dialog";
import { AddDialogContext, type AddPrefill } from "@/lib/add-dialog-context";
import { useJobs, useJobsSync } from "@/lib/use-downloads";
import { useSettings } from "@/lib/use-settings";
import { useApplyTheme } from "@/lib/theme";
import { bytes, speed } from "@/lib/format";
import { rpc } from "@/lib/rpc";

// Must match the main process: hiddenInset title bar is macOS-only.
const IS_MAC = navigator.userAgent.includes("Mac");

const NAV_ITEMS = [
	{ path: "/", label: "Downloads", icon: DownloadIcon },
	{ path: "/cloud", label: "Cloud", icon: CloudIcon },
	{ path: "/settings", label: "Settings", icon: SettingsIcon },
] as const;

function NavTab({
	path,
	label,
	icon: Icon,
	badge,
}: (typeof NAV_ITEMS)[number] & { badge?: number }) {
	const [location] = useLocation();
	const active =
		path === "/" ? location === "/" : location === path || location.startsWith(`${path}/`);
	return (
		<Link
			href={path}
			className={cn(
				"relative flex h-full items-center gap-2 px-3.5 text-[13px] whitespace-nowrap transition-colors",
				active
					? "text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary"
					: "text-muted-foreground hover:text-foreground",
			)}
		>
			<Icon className={cn("size-4", active && "text-primary")} />
			{label}
			{!!badge && (
				<span className="rounded-full bg-primary px-1.5 text-[10px] leading-4 font-semibold text-primary-foreground tabular-nums">
					{badge}
				</span>
			)}
		</Link>
	);
}

function StatusBar() {
	const { data: jobs = [] } = useJobs();
	const { data: settings } = useSettings();
	const { data: stats } = useQuery({
		queryKey: ["downloadStats", settings?.downloads.dir],
		queryFn: () => rpc.request.downloadStats(),
		refetchInterval: 15_000,
	});
	let down = 0;
	let active = 0;
	let queued = 0;
	let remote = 0;
	for (const j of jobs) {
		down += j.speed;
		if (j.status === "downloading") {
			active += j.tasks.filter((t) => t.status === "active").length;
			queued += j.tasks.filter((t) => t.status === "queued").length;
		}
		if (j.status === "queued") queued++;
		if (j.status === "remote" || j.status === "submitting" || j.status === "resolving") remote++;
	}
	const invalid = settings?.accounts.filter((a) => a.status === "invalid").length ?? 0;
	const limit = settings?.downloads.speedLimit ?? 0;

	return (
		<footer className="flex h-7 shrink-0 items-center gap-4 border-t bg-chrome px-3 text-[11.5px] text-muted-foreground tabular-nums">
			<span className={cn("flex items-center gap-1", down > 0 && "text-foreground")}>
				<ArrowDownIcon className={cn("size-3.5", down > 0 && "text-primary")} />
				{speed(down) || "0 B/s"}
				{limit > 0 && (
					<span className="text-muted-foreground">(limit {bytes(limit * 1024)}/s)</span>
				)}
			</span>
			<span>
				{active} active · {queued} queued
			</span>
			{remote > 0 && (
				<span className="flex items-center gap-1 text-warning">
					<HourglassIcon className="size-3.5" />
					{remote} on service
				</span>
			)}
			{invalid > 0 && (
				<Link href="/settings" className="text-destructive hover:underline">
					{invalid} account{invalid > 1 ? "s" : ""} need attention
				</Link>
			)}
			<span className="ml-auto flex items-center gap-1" title={settings?.downloads.dir}>
				<HardDriveIcon className="size-3.5" />
				{stats?.freeBytes != null ? `${bytes(stats.freeBytes)} free` : "—"}
			</span>
		</footer>
	);
}

function Shell({ children }: { children: ReactNode }) {
	const { data: jobs = [] } = useJobs();
	const activeCount = jobs.filter((j) =>
		["downloading", "remote", "submitting", "resolving", "queued"].includes(j.status),
	).length;

	return (
		<div className="flex h-screen flex-col bg-background text-foreground">
			<header
				className={cn(
					"electrobun-webkit-app-region-drag flex h-10 shrink-0 items-stretch border-b bg-chrome pr-2 select-none",
					IS_MAC ? "pl-[78px]" : "pl-3",
				)}
			>
				<div className="mr-2 flex items-center pr-1">
					<span className="flex size-5 items-center justify-center rounded-md bg-primary text-primary-foreground">
						<ArrowDownIcon className="size-3.5" strokeWidth={2.75} />
					</span>
				</div>
				<nav className="electrobun-webkit-app-region-no-drag flex items-stretch">
					{NAV_ITEMS.map((item) => (
						<NavTab key={item.path} {...item} badge={item.path === "/" ? activeCount : undefined} />
					))}
				</nav>
			</header>
			<main className="min-h-0 flex-1">{children}</main>
			<StatusBar />
		</div>
	);
}

function App() {
	useJobsSync();
	const { data: settings } = useSettings();
	useApplyTheme(settings?.general.theme);

	const [addOpen, setAddOpen] = useState(false);
	const [prefill, setPrefill] = useState<AddPrefill | undefined>();
	const openAdd = useCallback((p?: AddPrefill) => {
		setPrefill(p);
		setAddOpen(true);
	}, []);

	// Ctrl/Cmd+N opens the Add dialog anywhere.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
				e.preventDefault();
				openAdd();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [openAdd]);

	return (
		<AddDialogContext.Provider value={openAdd}>
			<TooltipProvider delay={400}>
				<Router hook={useHashLocation}>
					<Shell>
						<Switch>
							<Route path="/" component={DownloadsPage} />
							<Route path="/cloud" component={CloudPage} />
							<Route path="/settings" component={SettingsPage} />
							<Route path="/settings/:section" component={SettingsPage} />
							<Route component={DownloadsPage} />
						</Switch>
					</Shell>
					<AddDialog open={addOpen} onOpenChange={setAddOpen} prefill={prefill} />
				</Router>
				<Toaster
					position="bottom-right"
					offset={{ bottom: 36, right: 12 }}
					theme={settings?.general.theme ?? "system"}
					richColors={false}
				/>
			</TooltipProvider>
		</AddDialogContext.Provider>
	);
}

export default App;
