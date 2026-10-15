import { useCallback } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addedJobs } from "@/lib/use-downloads";
import { errText } from "@/lib/rpc";
import type { JobPublic } from "../../../shared/rpc-schema";

/** What the active tab exposes to the shared Cloud toolbar. */
export type TabApi = {
	selectedCount: number;
	download: () => void;
	remove?: () => void;
};

/** Run an add, seed the jobs cache, toast with a jump link. Stable identity. */
export function useSendToDownloads() {
	const qc = useQueryClient();
	const [, navigate] = useLocation();
	return useCallback(
		async (fn: () => Promise<JobPublic[]>) => {
			try {
				const jobs = await fn();
				addedJobs(qc, jobs);
				toast.success(`Sent ${jobs.length} item${jobs.length === 1 ? "" : "s"} to Downloads`, {
					action: { label: "View", onClick: () => navigate("/") },
				});
			} catch (err) {
				toast.error(errText(err));
			}
		},
		[qc, navigate],
	);
}

export function CloudEmpty({ text }: { text: string }) {
	return <p className="py-16 text-center text-sm text-muted-foreground">{text}</p>;
}

export function CloudError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
	return (
		<div className="flex flex-col items-center gap-3 py-16 text-center">
			<TriangleAlertIcon className="size-6 text-destructive" />
			<p className="max-w-md text-sm text-muted-foreground">{errText(error)}</p>
			<Button size="sm" variant="outline" onClick={onRetry}>
				Try again
			</Button>
		</div>
	);
}

export function LoadMore({
	hasMore,
	loading,
	onMore,
	count,
}: {
	hasMore: boolean;
	loading: boolean;
	onMore: () => void;
	count: number;
}) {
	if (!count) return null;
	return (
		<div className="flex items-center justify-center gap-3 py-3 text-xs text-muted-foreground">
			<span>{count} loaded</span>
			{hasMore && (
				<Button size="xs" variant="outline" disabled={loading} onClick={onMore}>
					{loading && <Loader2Icon className="animate-spin" />}
					Load more
				</Button>
			)}
		</div>
	);
}
