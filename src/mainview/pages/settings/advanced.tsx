import { FolderCogIcon, RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useConfirm } from "@/components/confirm";
import { useResetSettings, useSaveAdvanced, useSettings } from "@/lib/use-settings";
import { rpc } from "@/lib/rpc";
import { Group, PaneHeader, Row } from "./form";

const TIMEOUTS = [10, 20, 30, 60, 120].map((n) => ({ value: String(n), label: `${n} seconds` }));

export default function AdvancedSection() {
	const { data: settings } = useSettings();
	const save = useSaveAdvanced();
	const reset = useResetSettings();
	const [confirm, confirmNode] = useConfirm();
	const s = settings!;

	return (
		<>
			<PaneHeader title="Advanced" />

			<Group title="Network">
				<Row label="Service request timeout" hint="How long to wait for a debrid API response.">
					<Select
						items={TIMEOUTS}
						value={String(s.advanced.timeoutSec)}
						onValueChange={(v) => v && save.mutate({ timeoutSec: Number(v) })}
					>
						<SelectTrigger size="sm" className="w-32">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{TIMEOUTS.map((t) => (
								<SelectItem key={t.value} value={t.value}>
									{t.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</Row>
			</Group>

			<Group title="Data">
				<Row
					label="Configuration folder"
					hint={
						<span className="font-mono break-all" data-selectable>
							{s.configDir}
						</span>
					}
				>
					<Button size="sm" variant="outline" onClick={() => void rpc.request.openConfigFolder()}>
						<FolderCogIcon /> Open
					</Button>
				</Row>
				<Row
					label="Reset preferences"
					hint="Restores download, general and network settings. Accounts are kept."
				>
					<Button
						size="sm"
						variant="destructive"
						onClick={() =>
							confirm({
								title: "Reset preferences?",
								description:
									"Download folder, concurrency, theme and other options go back to defaults. Your accounts stay linked.",
								confirm: "Reset",
								destructive: true,
								onConfirm: () => reset.mutate(),
							})
						}
					>
						<RotateCcwIcon /> Reset…
					</Button>
				</Row>
			</Group>
			{confirmNode}
		</>
	);
}
