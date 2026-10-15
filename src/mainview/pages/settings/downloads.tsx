import { useEffect, useState } from "react";
import { FolderOpenIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { pickFolder, useSaveDownloadOpts, useSettings } from "@/lib/use-settings";
import { MAX_CONCURRENT, MIN_CONCURRENT, type ConflictMode } from "../../../shared/rpc-schema";
import { Group, PaneHeader, Row } from "./form";

const CONCURRENCY = Array.from({ length: MAX_CONCURRENT - MIN_CONCURRENT + 1 }, (_, i) => {
	const n = String(i + MIN_CONCURRENT);
	return { value: n, label: n };
});
const RETRIES = [0, 1, 2, 3, 5, 10].map((n) => ({ value: String(n), label: n === 0 ? "Never" : `${n} times` }));
const CONFLICT: { value: ConflictMode; label: string }[] = [
	{ value: "rename", label: "Keep both (rename)" },
	{ value: "overwrite", label: "Overwrite" },
	{ value: "skip", label: "Skip the file" },
];

/** Preferences apply immediately (desktop convention); text fields commit on blur/Enter. */
export default function DownloadsSection() {
	const { data: settings } = useSettings();
	const save = useSaveDownloadOpts();
	const d = settings!.downloads;
	const [dir, setDir] = useState(d.dir);
	const [limit, setLimit] = useState(String(d.speedLimit || ""));
	useEffect(() => setDir(d.dir), [d.dir]);
	useEffect(() => setLimit(d.speedLimit ? String(d.speedLimit) : ""), [d.speedLimit]);

	const commitDir = (value = dir) => value.trim() && value !== d.dir && save.mutate({ dir: value.trim() });
	const commitLimit = () => {
		const n = Math.max(0, Math.round(Number(limit) || 0));
		if (n !== d.speedLimit) save.mutate({ speedLimit: n });
	};

	return (
		<>
			<PaneHeader title="Downloads" description="Where files go and how they're transferred. Changes apply right away." />

			<Group title="Location">
				<Row label="Download folder" hint="New downloads are saved here unless you pick another folder when adding." stacked>
					<div className="flex gap-2">
						<Input
							value={dir}
							onChange={(e) => setDir(e.target.value)}
							onBlur={() => commitDir()}
							onKeyDown={(e) => e.key === "Enter" && commitDir()}
							className="h-8 font-mono text-xs"
							spellCheck={false}
						/>
						<Button
							variant="outline"
							size="sm"
							className="h-8"
							onClick={async () => {
								const p = await pickFolder(dir);
								if (p) {
									setDir(p);
									commitDir(p);
								}
							}}
						>
							<FolderOpenIcon /> Browse…
						</Button>
					</div>
				</Row>
				<Row label="Create a folder for multi-file torrents" hint="Files are grouped under the torrent's name.">
					<Switch checked={d.subfolder} onCheckedChange={(v) => save.mutate({ subfolder: v })} />
				</Row>
				<Row label="If a file already exists">
					<Select
						items={CONFLICT}
						value={d.conflict}
						onValueChange={(v) => v && save.mutate({ conflict: v as ConflictMode })}
					>
						<SelectTrigger size="sm" className="w-48">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{CONFLICT.map((c) => (
								<SelectItem key={c.value} value={c.value}>
									{c.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</Row>
			</Group>

			<Group title="Transfers">
				<Row label="Simultaneous downloads" hint="Files transferring at the same time. Others wait in the queue.">
					<Select
						items={CONCURRENCY}
						value={String(d.concurrent)}
						onValueChange={(v) => v && save.mutate({ concurrent: Number(v) })}
					>
						<SelectTrigger size="sm" className="w-20">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{CONCURRENCY.map((c) => (
								<SelectItem key={c.value} value={c.value}>
									{c.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</Row>
				<Row label="Speed limit" hint="Shared across all downloads. Leave empty for unlimited.">
					<div className="flex items-center gap-2">
						<Input
							inputMode="numeric"
							value={limit}
							onChange={(e) => setLimit(e.target.value.replace(/[^\d]/g, ""))}
							onBlur={commitLimit}
							onKeyDown={(e) => e.key === "Enter" && commitLimit()}
							placeholder="Unlimited"
							className="h-8 w-28 text-right tabular-nums"
						/>
						<span className="text-xs text-muted-foreground">KiB/s</span>
					</div>
				</Row>
				<Row label="Retry failed files" hint="Network errors are retried with increasing delays.">
					<Select
						items={RETRIES}
						value={String(d.retries)}
						onValueChange={(v) => v && save.mutate({ retries: Number(v) })}
					>
						<SelectTrigger size="sm" className="w-28">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{RETRIES.map((c) => (
								<SelectItem key={c.value} value={c.value}>
									{c.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</Row>
			</Group>
		</>
	);
}
