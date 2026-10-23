import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useSaveGeneral, useSettings } from "@/lib/use-settings";
import type { ThemeMode } from "../../../shared/rpc-schema";
import { Group, PaneHeader, Row } from "./form";

const THEMES: { value: ThemeMode; label: string; icon: typeof SunIcon }[] = [
	{ value: "system", label: "System", icon: MonitorIcon },
	{ value: "light", label: "Light", icon: SunIcon },
	{ value: "dark", label: "Dark", icon: MoonIcon },
];
const POLL = [5, 10, 15, 30, 60].map((n) => ({ value: String(n), label: `Every ${n}s` }));

export default function GeneralSection() {
	const { data: settings } = useSettings();
	const save = useSaveGeneral();
	const g = settings!.general;

	return (
		<>
			<PaneHeader title="General" description="Appearance and app behaviour." />

			<Group title="Appearance">
				<Row label="Theme">
					<div className="flex rounded-lg bg-muted p-0.5">
						{THEMES.map((t) => (
							<button
								key={t.value}
								type="button"
								onClick={() => save.mutate({ theme: t.value })}
								className={cn(
									"flex h-7 items-center gap-1.5 rounded-md px-3 text-[13px] transition-colors [&_svg]:size-3.5",
									g.theme === t.value
										? "bg-background font-medium shadow-sm"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								<t.icon />
								{t.label}
							</button>
						))}
					</div>
				</Row>
			</Group>

			<Group title="Behaviour">
				<Row
					label="Detect links on the clipboard"
					hint="Offer to add a magnet or link you copied when the window gets focus."
				>
					<Switch checked={g.clipboard} onCheckedChange={(v) => save.mutate({ clipboard: v })} />
				</Row>
				<Row label="Notify when a download completes" hint="Uses your system's notifications.">
					<Switch checked={g.notify} onCheckedChange={(v) => save.mutate({ notify: v })} />
				</Row>
				<Row
					label="Remove from debrid account after downloading"
					hint="Keeps your cloud tidy. The torrent is deleted from the service once every file is on disk."
				>
					<Switch
						checked={g.deleteAfter}
						onCheckedChange={(v) => save.mutate({ deleteAfter: v })}
					/>
				</Row>
				<Row
					label="Check service progress"
					hint="How often uncached torrents are checked. Slows to every 30s after 10 minutes without progress."
				>
					<Select
						items={POLL}
						value={String(g.pollSeconds)}
						onValueChange={(v) => v && save.mutate({ pollSeconds: Number(v) })}
					>
						<SelectTrigger size="sm" className="w-32">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{POLL.map((p) => (
								<SelectItem key={p.value} value={p.value}>
									{p.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</Row>
			</Group>
		</>
	);
}
