// Downloads data layer: seeded once by listJobs, then kept current by the
// main process' jobsChanged diffs (no polling from the view).
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errText, onPush, rpc } from "./rpc";
import type { AddJobsInput, JobAction, JobPublic } from "../../shared/rpc-schema";

export const JOBS_KEY = ["jobs"] as const;

/** Mount once (App) so pushes are applied even when Downloads isn't visible. */
export function useJobsSync() {
	const qc = useQueryClient();
	useEffect(
		() =>
			onPush("jobsChanged", ({ upserts, removed }) => {
				qc.setQueryData<JobPublic[]>(JOBS_KEY, (prev) => {
					if (!prev) return prev; // not seeded yet; the initial fetch will include these
					const gone = new Set(removed);
					const byId = new Map(upserts.map((j) => [j.id, j]));
					const next = prev.filter((j) => !gone.has(j.id)).map((j) => byId.get(j.id) ?? j);
					for (const j of upserts) if (!prev.some((p) => p.id === j.id)) next.push(j);
					return next;
				});
			}),
		[qc],
	);
	useEffect(
		() =>
			onPush("notify", ({ kind, title, description }) => {
				toast[kind](title, { description });
			}),
		[],
	);
}

export function useJobs() {
	return useQuery({
		queryKey: JOBS_KEY,
		queryFn: () => rpc.request.listJobs(),
		staleTime: Infinity,
	});
}

function mergeJobs(prev: JobPublic[] | undefined, added: JobPublic[]): JobPublic[] {
	const list = prev ? [...prev] : [];
	for (const j of added) if (!list.some((p) => p.id === j.id)) list.push(j);
	return list;
}

export function useAddJobs() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: AddJobsInput) => rpc.request.addJobs(input),
		onSuccess: (jobs) => qc.setQueryData<JobPublic[]>(JOBS_KEY, (p) => mergeJobs(p, jobs)),
	});
}

export function useAddTorrentFiles() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: {
			files: { name: string; base64: string }[];
			accountId: string;
			dir?: string;
			start?: boolean;
		}) => rpc.request.addTorrentFiles(input),
		onSuccess: (jobs) => qc.setQueryData<JobPublic[]>(JOBS_KEY, (p) => mergeJobs(p, jobs)),
	});
}

export function addedJobs(qc: ReturnType<typeof useQueryClient>, jobs: JobPublic[]) {
	qc.setQueryData<JobPublic[]>(JOBS_KEY, (p) => mergeJobs(p, jobs));
}

export async function jobAction(ids: string[], action: JobAction): Promise<void> {
	try {
		await rpc.request.jobAction({ ids, action });
	} catch (err) {
		toast.error(errText(err));
	}
}

export async function taskAction(
	jobId: string,
	taskIds: string[],
	action: "pause" | "resume" | "retry",
): Promise<void> {
	try {
		await rpc.request.taskAction({ jobId, taskIds, action });
	} catch (err) {
		toast.error(errText(err));
	}
}

/** Read a dropped/picked .torrent File as base64 (browser-side, no Node APIs). */
export async function fileToBase64(file: File): Promise<string> {
	const buf = new Uint8Array(await file.arrayBuffer());
	let bin = "";
	for (let i = 0; i < buf.length; i += 0x8000) {
		bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
	}
	return btoa(bin);
}
