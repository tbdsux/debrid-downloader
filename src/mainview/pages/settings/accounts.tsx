import { useEffect, useState } from "react";
import {
	DndContext,
	type DragEndEvent,
	PointerSensor,
	closestCenter,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	SortableContext,
	arrayMove,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import {
	ExternalLinkIcon,
	GripVerticalIcon,
	KeyRoundIcon,
	Loader2Icon,
	MoreHorizontalIcon,
	PencilIcon,
	PlusIcon,
	RefreshCwIcon,
	StarIcon,
	Trash2Icon,
	TriangleAlertIcon,
	UsersIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { ProviderBadge } from "@/components/app-ui";
import { useConfirm } from "@/components/confirm";
import {
	useAddAccountWithKey,
	useRefreshAccount,
	useRemoveAccount,
	useReorderAccounts,
	useSettings,
	useUpdateAccount,
	NO_ACCOUNTS,
} from "@/lib/use-settings";
import { errText, rpc } from "@/lib/rpc";
import {
	PROVIDERS,
	PROVIDER_IDS,
	type AccountPublic,
	type ProviderId,
} from "../../../shared/rpc-schema";
import { PaneHeader } from "./form";

export default function AccountsSection() {
	const { data: settings } = useSettings();
	const accounts = settings?.accounts ?? NO_ACCOUNTS;
	const reorder = useReorderAccounts();
	const [adding, setAdding] = useState<ProviderId | null | "pick">(null);
	const [order, setOrder] = useState(accounts.map((a) => a.id));
	useEffect(() => setOrder(accounts.map((a) => a.id)), [accounts]);
	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
	const byId = new Map(accounts.map((a) => [a.id, a]));

	function onDragEnd({ active, over }: DragEndEvent) {
		if (!over || active.id === over.id) return;
		const next = arrayMove(order, order.indexOf(String(active.id)), order.indexOf(String(over.id)));
		setOrder(next);
		reorder.mutate(next);
	}

	return (
		<>
			<PaneHeader
				title="Accounts"
				description="Link debrid accounts. You can add several per service; drag to set the order Auto uses."
				action={
					accounts.length > 0 && (
						<Button size="sm" onClick={() => setAdding("pick")}>
							<PlusIcon /> Add account
						</Button>
					)
				}
			/>

			{accounts.length === 0 ? (
				<Empty className="rounded-lg border border-dashed py-12">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<UsersIcon />
						</EmptyMedia>
						<EmptyTitle>No accounts linked</EmptyTitle>
						<EmptyDescription>
							Paste an API key from Real-Debrid, AllDebrid or Premiumize to get started.
						</EmptyDescription>
					</EmptyHeader>
					<EmptyContent className="flex-row justify-center">
						{PROVIDER_IDS.map((p) => (
							<Button key={p} size="sm" variant="outline" onClick={() => setAdding(p)}>
								<ProviderBadge provider={p} /> {PROVIDERS[p].name}
							</Button>
						))}
					</EmptyContent>
				</Empty>
			) : (
				<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
					<SortableContext items={order} strategy={verticalListSortingStrategy}>
						<ul className="divide-y rounded-lg border">
							{order.map((id, i) => {
								const a = byId.get(id);
								return a ? <AccountRow key={id} account={a} index={i} /> : null;
							})}
						</ul>
					</SortableContext>
				</DndContext>
			)}

			<div className="mt-4 rounded-lg bg-muted/50 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
				<p className="flex items-center gap-1.5 font-medium text-foreground">
					<KeyRoundIcon className="size-3.5" /> How keys are stored
				</p>
				<p className="mt-1">
					Keys and sign-in tokens are encrypted on this computer (XChaCha20-Poly1305) and only used
					by the app's background process — this window never sees them. To change a key, replace
					it.
				</p>
			</div>

			<AddAccountDialog
				initial={adding === "pick" ? null : adding}
				open={adding !== null}
				onOpenChange={(o) => !o && setAdding(null)}
			/>
		</>
	);
}

function AccountRow({ account: a, index }: { account: AccountPublic; index: number }) {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id: a.id,
	});
	const update = useUpdateAccount();
	const refresh = useRefreshAccount();
	const remove = useRemoveAccount();
	const [confirm, confirmNode] = useConfirm();
	const [renaming, setRenaming] = useState(false);
	const [label, setLabel] = useState(a.label);
	const [replacing, setReplacing] = useState(false);

	const expires = a.expiresAt ? new Date(a.expiresAt) : null;
	const days = expires ? Math.ceil((expires.getTime() - Date.now()) / 86_400_000) : null;

	return (
		<li
			ref={setNodeRef}
			style={{ transform: CSS.Transform.toString(transform), transition }}
			className={cn(
				"flex items-center gap-3 bg-background px-3 py-2.5 first:rounded-t-lg last:rounded-b-lg",
				isDragging && "relative z-10 shadow-lg ring-1 ring-primary/30",
			)}
		>
			<button
				type="button"
				aria-label={`Reorder ${a.label}`}
				{...attributes}
				{...listeners}
				className="shrink-0 cursor-grab touch-none text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
			>
				<GripVerticalIcon className="size-4" />
			</button>
			<span className="w-4 shrink-0 text-center text-xs text-muted-foreground tabular-nums">
				{index + 1}
			</span>
			<ProviderBadge provider={a.provider} className="h-5 min-w-8 text-[11px]" />
			<div className="min-w-0 flex-1">
				{renaming ? (
					<form
						className="flex items-center gap-1.5"
						onSubmit={(e) => {
							e.preventDefault();
							update.mutate({ id: a.id, label });
							setRenaming(false);
						}}
					>
						<Input
							autoFocus
							value={label}
							onChange={(e) => setLabel(e.target.value)}
							onBlur={() => setRenaming(false)}
							onKeyDown={(e) => e.key === "Escape" && setRenaming(false)}
							className="h-7 max-w-56"
						/>
					</form>
				) : (
					<div className="flex items-center gap-2 text-[13px]">
						<span className="truncate font-medium">{a.label}</span>
						{a.isDefault && (
							<span className="flex items-center gap-0.5 rounded-full bg-primary/12 px-1.5 text-[10.5px] font-medium text-primary">
								<StarIcon className="size-2.5 fill-current" /> Default
							</span>
						)}
					</div>
				)}
				<div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
					<span>{PROVIDERS[a.provider].name}</span>
					{a.username && <span>· {a.username}</span>}
					<span className="font-mono">· ••••{a.hint}</span>
					<span>· {a.auth === "oauth" ? "signed in" : "API key"}</span>
				</div>
			</div>

			<div className="shrink-0 text-right text-xs">
				{a.status === "invalid" ? (
					<span className="flex items-center gap-1 text-destructive" title={a.lastError}>
						<TriangleAlertIcon className="size-3.5" /> Needs new key
					</span>
				) : a.premium ? (
					<span className={cn(days != null && days < 7 ? "text-warning" : "text-success")}>
						Premium{days != null ? ` · ${days}d left` : ""}
					</span>
				) : a.premium === false ? (
					<span className="text-muted-foreground">Free / expired</span>
				) : (
					<span className="text-muted-foreground">Not checked</span>
				)}
			</div>

			<DropdownMenu>
				<DropdownMenuTrigger
					aria-label="Account actions"
					className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
				>
					{refresh.isPending ? <Loader2Icon className="animate-spin" /> : <MoreHorizontalIcon />}
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="min-w-48">
					<DropdownMenuItem
						disabled={a.isDefault}
						onClick={() => update.mutate({ id: a.id, isDefault: true })}
					>
						<StarIcon /> Make default
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={() => {
							setLabel(a.label);
							setRenaming(true);
						}}
					>
						<PencilIcon /> Rename
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => refresh.mutate(a.id)}>
						<RefreshCwIcon /> Check account
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => setReplacing(true)}>
						<KeyRoundIcon /> Replace API key…
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						variant="destructive"
						onClick={() =>
							confirm({
								title: `Remove "${a.label}"?`,
								description: `The ${PROVIDERS[a.provider].name} credentials are deleted from this computer. Downloads using it will stop working.`,
								confirm: "Remove account",
								destructive: true,
								onConfirm: () => remove.mutate(a.id),
							})
						}
					>
						<Trash2Icon /> Remove
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<ReplaceKeyDialog account={a} open={replacing} onOpenChange={setReplacing} />
			{confirmNode}
		</li>
	);
}

function ReplaceKeyDialog({
	account,
	open,
	onOpenChange,
}: {
	account: AccountPublic;
	open: boolean;
	onOpenChange: (o: boolean) => void;
}) {
	const update = useUpdateAccount();
	const [key, setKey] = useState("");
	useEffect(() => {
		if (open) setKey("");
	}, [open]);
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Replace API key</DialogTitle>
					<DialogDescription>
						For {PROVIDERS[account.provider].name} · {account.label}. The new key is verified before
						it's saved.
					</DialogDescription>
				</DialogHeader>
				<Input
					type="password"
					autoFocus
					value={key}
					onChange={(e) => setKey(e.target.value)}
					placeholder="Paste the new API key"
					className="font-mono"
				/>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						disabled={!key.trim() || update.isPending}
						onClick={async () => {
							await update.mutateAsync({ id: account.id, apiKey: key });
							toast.success("Key replaced");
							onOpenChange(false);
						}}
					>
						{update.isPending ? "Verifying…" : "Save key"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

// ---------------------------------------------------------------- add dialog

function AddAccountDialog({
	initial,
	open,
	onOpenChange,
}: {
	initial: ProviderId | null;
	open: boolean;
	onOpenChange: (o: boolean) => void;
}) {
	const addKey = useAddAccountWithKey();
	const [provider, setProvider] = useState<ProviderId>("real-debrid");
	const [label, setLabel] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;
		setProvider(initial ?? "real-debrid");
		setLabel("");
		setApiKey("");
		setError(null);
	}, [open, initial]);

	async function saveKey() {
		setError(null);
		try {
			await addKey.mutateAsync({ provider, label, apiKey });
			toast.success(`${PROVIDERS[provider].name} account added`);
			onOpenChange(false);
		} catch (err) {
			setError(errText(err));
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="gap-0 p-0 sm:max-w-lg">
				<DialogHeader className="border-b px-4 pt-4 pb-3">
					<DialogTitle>Add account</DialogTitle>
					<DialogDescription>Choose a service and paste its API key.</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-4 p-4">
					<div className="grid grid-cols-3 gap-2">
						{PROVIDER_IDS.map((p) => (
							<button
								key={p}
								type="button"
								onClick={() => {
									setProvider(p);
									setError(null);
								}}
								className={cn(
									"flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-colors",
									provider === p
										? "border-primary bg-primary/5 ring-1 ring-primary"
										: "hover:bg-accent",
								)}
							>
								<ProviderBadge provider={p} />
								<span className="text-[13px] font-medium">{PROVIDERS[p].name}</span>
							</button>
						))}
					</div>

					<div className="grid grid-cols-[80px_1fr] items-center gap-x-3 gap-y-3">
						<Label className="text-muted-foreground">Label</Label>
						<Input
							value={label}
							onChange={(e) => setLabel(e.target.value)}
							placeholder="e.g. main, family, backup"
							className="h-8"
						/>

						<Label className="text-muted-foreground">API key</Label>
						<Input
							type="password"
							autoFocus
							value={apiKey}
							onChange={(e) => setApiKey(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && apiKey.trim() && void saveKey()}
							placeholder="Paste your API key"
							className="h-8 font-mono"
						/>

						<span />
						<button
							type="button"
							onClick={() => void rpc.request.openExternal({ url: PROVIDERS[provider].keyUrl })}
							className="flex w-fit items-center gap-1 text-xs text-primary hover:underline"
						>
							Get your {PROVIDERS[provider].name} API key <ExternalLinkIcon className="size-3" />
						</button>
					</div>

					{error && (
						<p className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
							<TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
							{error}
						</p>
					)}
				</div>

				<DialogFooter className="m-0 rounded-b-xl px-4 py-3">
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button disabled={!apiKey.trim() || addKey.isPending} onClick={saveKey}>
						{addKey.isPending ? "Verifying…" : "Add account"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
