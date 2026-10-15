import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { FileIcon, FolderOpenIcon, LinkIcon, MagnetIcon, UploadIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { AccountSelect } from "@/components/app-ui";
import { pickFolder, useSettings } from "@/lib/use-settings";
import { fileToBase64, useAddJobs, useAddTorrentFiles } from "@/lib/use-downloads";
import { errText, rpc } from "@/lib/rpc";
import { bytes } from "@/lib/format";
import type { AddPrefill, AddTab } from "@/lib/add-dialog-context";

const MAGNET_RE = /^(magnet:\?.*xt=urn:btih:|[a-f0-9]{40}$)/i;
const URL_RE = /^https?:\/\/\S+$/i;

function lines(text: string): string[] {
	return text
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean);
}

type PickedFile = { name: string; base64: string };

export function AddDialog({
	open,
	onOpenChange,
	prefill,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	prefill?: AddPrefill;
}) {
	const { data: settings } = useSettings();
	const accounts = settings?.accounts ?? [];
	const [tab, setTab] = useState<AddTab>("magnet");
	const [magnets, setMagnets] = useState("");
	const [links, setLinks] = useState("");
	const [files, setFiles] = useState<PickedFile[]>([]);
	const [accountId, setAccountId] = useState("auto");
	const [dir, setDir] = useState("");
	const [start, setStart] = useState(true);
	const [dragging, setDragging] = useState(false);
	const textRef = useRef<HTMLTextAreaElement>(null);
	const addJobs = useAddJobs();
	const addTorrents = useAddTorrentFiles();

	// Reset each time the dialog opens, applying any prefill.
	useEffect(() => {
		if (!open) return;
		setTab(prefill?.tab ?? (prefill?.files?.length ? "torrent" : "magnet"));
		setMagnets(prefill?.tab === "magnet" || !prefill?.tab ? (prefill?.text ?? "") : "");
		setLinks(prefill?.tab === "link" ? (prefill.text ?? "") : "");
		setFiles(prefill?.files ?? []);
		setDir(settings?.downloads.dir ?? "");
		setStart(true);
		setAccountId((cur) => (cur === "auto" || accounts.some((a) => a.id === cur) ? cur : "auto"));
		setTimeout(() => textRef.current?.focus(), 50);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open]);

	const magnetLines = useMemo(() => lines(magnets), [magnets]);
	const linkLines = useMemo(() => lines(links), [links]);
	const badMagnets = magnetLines.filter((l) => !MAGNET_RE.test(l)).length;
	const badLinks = linkLines.filter((l) => !URL_RE.test(l)).length;

	const count =
		tab === "magnet"
			? magnetLines.length - badMagnets
			: tab === "link"
				? linkLines.length - badLinks
				: files.length;
	const pending = addJobs.isPending || addTorrents.isPending;

	async function submit() {
		const common = { accountId, dir: dir.trim() || undefined, start };
		try {
			if (tab === "torrent") {
				await addTorrents.mutateAsync({ files, ...common });
			} else {
				const inputs =
					tab === "magnet"
						? magnetLines.filter((l) => MAGNET_RE.test(l))
						: linkLines.filter((l) => URL_RE.test(l));
				await addJobs.mutateAsync({ kind: tab, inputs, ...common });
			}
			toast.success(`Added ${count} item${count === 1 ? "" : "s"}`);
			onOpenChange(false);
		} catch (err) {
			toast.error(errText(err));
		}
	}

	async function chooseTorrents() {
		try {
			const picked = await rpc.request.pickTorrentFiles();
			if (picked.length) setFiles((f) => dedupe([...f, ...picked]));
		} catch (err) {
			toast.error(errText(err));
		}
	}

	async function onDrop(e: DragEvent) {
		e.preventDefault();
		setDragging(false);
		const dropped = [...e.dataTransfer.files].filter((f) => f.name.toLowerCase().endsWith(".torrent"));
		if (dropped.length) {
			const read = await Promise.all(
				dropped.map(async (f) => ({ name: f.name, base64: await fileToBase64(f) })),
			);
			setFiles((f) => dedupe([...f, ...read]));
			setTab("torrent");
			return;
		}
		const text = e.dataTransfer.getData("text/plain");
		if (text) {
			if (MAGNET_RE.test(text.trim())) {
				setTab("magnet");
				setMagnets((m) => (m ? `${m}\n${text.trim()}` : text.trim()));
			} else {
				setTab("link");
				setLinks((l) => (l ? `${l}\n${text.trim()}` : text.trim()));
			}
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="gap-0 p-0 sm:max-w-xl"
				onDragOver={(e) => {
					e.preventDefault();
					setDragging(true);
				}}
				onDragLeave={() => setDragging(false)}
				onDrop={onDrop}
			>
				<DialogHeader className="border-b px-4 pt-4 pb-3">
					<DialogTitle>Add downloads</DialogTitle>
					<DialogDescription>
						The debrid service fetches it first; files then download to your computer.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-4 p-4">
					<Tabs value={tab} onValueChange={(v) => v && setTab(v as AddTab)}>
						<TabsList className="w-full">
							<TabsTrigger value="magnet">
								<MagnetIcon /> Magnet
							</TabsTrigger>
							<TabsTrigger value="torrent">
								<FileIcon /> Torrent file
							</TabsTrigger>
							<TabsTrigger value="link">
								<LinkIcon /> Links
							</TabsTrigger>
						</TabsList>
					</Tabs>

					{tab === "magnet" && (
						<div className="flex flex-col gap-1.5">
							<Textarea
								ref={textRef}
								value={magnets}
								onChange={(e) => setMagnets(e.target.value)}
								placeholder={"magnet:?xt=urn:btih:…\nOne magnet link (or info hash) per line"}
								className="h-36 resize-none font-mono text-xs break-all"
								spellCheck={false}
							/>
							<LineHint total={magnetLines.length} bad={badMagnets} noun="magnet" />
						</div>
					)}

					{tab === "link" && (
						<div className="flex flex-col gap-1.5">
							<Textarea
								ref={textRef}
								value={links}
								onChange={(e) => setLinks(e.target.value)}
								placeholder={"https://hoster.example/file/…\nOne hoster or direct link per line"}
								className="h-36 resize-none font-mono text-xs break-all"
								spellCheck={false}
							/>
							<LineHint total={linkLines.length} bad={badLinks} noun="link" />
						</div>
					)}

					{tab === "torrent" && (
						<div
							className={cn(
								"flex min-h-36 flex-col rounded-lg border border-dashed transition-colors",
								dragging ? "border-primary bg-primary/5" : "bg-muted/30",
							)}
						>
							{files.length === 0 ? (
								<div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
									<UploadIcon className="size-6 text-muted-foreground" />
									<p className="text-[13px] text-muted-foreground">
										Drop <span className="font-mono">.torrent</span> files here
									</p>
									<Button size="sm" variant="outline" onClick={chooseTorrents}>
										Choose files…
									</Button>
								</div>
							) : (
								<div className="flex flex-col">
									<ul className="max-h-40 divide-y overflow-auto">
										{files.map((f) => (
											<li key={f.name} className="flex items-center gap-2 px-3 py-1.5 text-[13px]">
												<FileIcon className="size-4 shrink-0 text-muted-foreground" />
												<span className="min-w-0 flex-1 truncate">{f.name}</span>
												<span className="text-xs text-muted-foreground tabular-nums">
													{bytes(Math.floor((f.base64.length * 3) / 4))}
												</span>
												<button
													type="button"
													aria-label={`Remove ${f.name}`}
													onClick={() => setFiles((all) => all.filter((x) => x.name !== f.name))}
													className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
												>
													<XIcon className="size-3.5" />
												</button>
											</li>
										))}
									</ul>
									<div className="border-t px-3 py-1.5">
										<Button size="xs" variant="ghost" onClick={chooseTorrents}>
											Add more…
										</Button>
									</div>
								</div>
							)}
						</div>
					)}

					<div className="grid grid-cols-[88px_1fr] items-center gap-x-3 gap-y-2.5">
						<Label className="text-muted-foreground">Account</Label>
						{accounts.length ? (
							<AccountSelect accounts={accounts} value={accountId} onChange={setAccountId} allowAuto className="w-full" />
						) : (
							<p className="text-[13px] text-muted-foreground">
								No accounts yet —{" "}
								<Link
									href="/settings"
									onClick={() => onOpenChange(false)}
									className="text-primary hover:underline"
								>
									add one in Settings
								</Link>
							</p>
						)}

						<Label className="text-muted-foreground">Save to</Label>
						<div className="flex gap-2">
							<Input
								value={dir}
								onChange={(e) => setDir(e.target.value)}
								className="h-7 font-mono text-xs"
								spellCheck={false}
							/>
							<Button
								size="sm"
								variant="outline"
								onClick={async () => {
									const p = await pickFolder(dir);
									if (p) setDir(p);
								}}
							>
								<FolderOpenIcon /> Browse
							</Button>
						</div>

						<span />
						<label className="flex items-center gap-2 text-[13px]">
							<Switch size="sm" checked={start} onCheckedChange={(v) => setStart(v)} />
							Start immediately
						</label>
					</div>
				</div>

				<DialogFooter className="m-0 rounded-b-xl px-4 py-3">
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button disabled={!count || !accounts.length || pending} onClick={submit}>
						{pending ? "Adding…" : count > 1 ? `Add ${count} items` : "Add"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function LineHint({ total, bad, noun }: { total: number; bad: number; noun: string }) {
	if (!total) return <p className="text-xs text-muted-foreground">Tip: paste several at once.</p>;
	return (
		<p className="text-xs text-muted-foreground tabular-nums">
			{total - bad} {noun}
			{total - bad === 1 ? "" : "s"}
			{bad > 0 && <span className="text-destructive"> · {bad} line(s) not recognised</span>}
		</p>
	);
}

function dedupe(files: PickedFile[]): PickedFile[] {
	const seen = new Set<string>();
	return files.filter((f) => (seen.has(f.name) ? false : (seen.add(f.name), true)));
}
