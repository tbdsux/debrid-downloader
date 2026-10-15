// Small app-specific building blocks shared across pages (desktop-style
// toolbar buttons, provider badges, thin progress bars, account picker).
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	PROVIDERS,
	PROVIDER_IDS,
	type AccountPublic,
	type ProviderId,
} from "../../shared/rpc-schema";

const PROVIDER_TONE: Record<ProviderId, string> = {
	"real-debrid": "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30",
	"all-debrid": "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/30",
	premiumize: "bg-sky-500/15 text-sky-700 dark:text-sky-300 ring-sky-500/30",
};

export function ProviderBadge({
	provider,
	className,
}: {
	provider: ProviderId;
	className?: string;
}) {
	return (
		<span
			title={PROVIDERS[provider].name}
			className={cn(
				"inline-flex h-4 min-w-6 shrink-0 items-center justify-center rounded-[4px] px-1 text-[10px] font-semibold tracking-wide ring-1 ring-inset",
				PROVIDER_TONE[provider],
				className,
			)}
		>
			{PROVIDERS[provider].short}
		</span>
	);
}

export function AccountName({ account, className }: { account?: AccountPublic; className?: string }) {
	if (!account) return <span className={cn("text-muted-foreground", className)}>Removed account</span>;
	return (
		<span className={cn("flex min-w-0 items-center gap-1.5", className)}>
			<ProviderBadge provider={account.provider} />
			<span className="truncate">{account.label}</span>
		</span>
	);
}

/** Thin progress bar; `tone` is a bg-* class. */
export function Bar({
	value,
	tone = "bg-primary",
	className,
	striped,
}: {
	value: number;
	tone?: string;
	className?: string;
	striped?: boolean;
}) {
	return (
		<div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
			<div
				className={cn(
					"h-full rounded-full transition-[width] duration-300 ease-out",
					tone,
					striped && "bg-stripes animate-stripes",
				)}
				style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
			/>
		</div>
	);
}

/** Icon + label toolbar button with optional tooltip (desktop style). */
export function ToolButton({
	icon,
	label,
	tip,
	showLabel = true,
	className,
	tone,
	...props
}: ComponentProps<"button"> & {
	icon: ReactNode;
	label: string;
	tip?: string;
	showLabel?: boolean;
	tone?: "danger" | "primary";
}) {
	const btn = (
		<button
			type="button"
			aria-label={label}
			className={cn(
				"inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] text-foreground/85 transition-colors outline-none",
				"hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
				"disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0",
				tone === "danger" && "hover:bg-destructive/10 hover:text-destructive",
				tone === "primary" &&
					"bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
				className,
			)}
			{...props}
		>
			{icon}
			{showLabel && <span>{label}</span>}
		</button>
	);
	if (!tip) return btn;
	return (
		<Tooltip>
			<TooltipTrigger render={btn} />
			<TooltipContent side="bottom">{tip}</TooltipContent>
		</Tooltip>
	);
}

export function ToolSep() {
	return <div className="mx-1 h-5 w-px shrink-0 bg-border" />;
}

/** Account select used in the Add dialog and Cloud header. */
export function AccountSelect({
	accounts,
	value,
	onChange,
	allowAuto,
	className,
}: {
	accounts: AccountPublic[];
	value: string;
	onChange: (id: string) => void;
	allowAuto?: boolean;
	className?: string;
}) {
	const def = accounts.find((a) => a.isDefault);
	const items = [
		...(allowAuto ? [{ value: "auto", label: `Auto${def ? ` (${def.label})` : ""}` }] : []),
		...accounts.map((a) => ({ value: a.id, label: `${PROVIDERS[a.provider].short} · ${a.label}` })),
	];
	return (
		<Select items={items} value={value} onValueChange={(v) => v && onChange(v)}>
			<SelectTrigger size="sm" className={cn("min-w-48", className)}>
				<SelectValue />
			</SelectTrigger>
			{/* Grow to fit labels (never narrower than the trigger) instead of clipping them. */}
			<SelectContent className="w-auto max-w-(--available-width) min-w-(--anchor-width)">
				{allowAuto && (
					<SelectGroup>
						<SelectItem value="auto">
							<span className="flex items-center gap-2">
								<span className="inline-flex h-4 min-w-6 items-center justify-center rounded-[4px] bg-primary/15 px-1 text-[10px] font-semibold text-primary">
									A
								</span>
								Auto
								{def && <span className="text-muted-foreground">— default: {def.label}</span>}
							</span>
						</SelectItem>
					</SelectGroup>
				)}
				{PROVIDER_IDS.filter((p) => accounts.some((a) => a.provider === p)).map((p) => (
					<SelectGroup key={p}>
						<SelectLabel>{PROVIDERS[p].name}</SelectLabel>
						{accounts
							.filter((a) => a.provider === p)
							.map((a) => (
								<SelectItem key={a.id} value={a.id}>
									<span className="flex items-center gap-2">
										<ProviderBadge provider={a.provider} />
										{a.label}
										{a.username && <span className="text-muted-foreground">{a.username}</span>}
										{a.status === "invalid" && <span className="text-destructive">· invalid</span>}
									</span>
								</SelectItem>
							))}
					</SelectGroup>
				))}
			</SelectContent>
		</Select>
	);
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
	return (
		<div className="flex items-center justify-between gap-2 px-3 pt-3 pb-1">
			<span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
				{children}
			</span>
			{action}
		</div>
	);
}

export function Kbd({ children }: { children: ReactNode }) {
	return (
		<kbd className="rounded border bg-muted px-1 font-mono text-[10px] text-muted-foreground">{children}</kbd>
	);
}
