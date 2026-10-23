// Desktop preference-pane building blocks: titled groups with label/control
// rows separated by hairlines (no cards).
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PaneHeader({
	title,
	description,
	action,
}: {
	title: string;
	description?: string;
	action?: ReactNode;
}) {
	return (
		<div className="mb-5 flex items-start justify-between gap-4">
			<div>
				<h1 className="text-base font-semibold">{title}</h1>
				{description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
			</div>
			{action}
		</div>
	);
}

export function Group({
	title,
	children,
	className,
}: {
	title?: string;
	children: ReactNode;
	className?: string;
}) {
	return (
		<section className={cn("mb-6", className)}>
			{title && (
				<h2 className="mb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
					{title}
				</h2>
			)}
			<div className="divide-y rounded-lg border bg-background">{children}</div>
		</section>
	);
}

export function Row({
	label,
	hint,
	children,
	stacked,
}: {
	label: ReactNode;
	hint?: ReactNode;
	children: ReactNode;
	stacked?: boolean;
}) {
	return (
		<div
			className={cn(
				"flex gap-4 px-4 py-3",
				stacked ? "flex-col gap-2" : "items-center justify-between",
			)}
		>
			<div className="min-w-0">
				<div className="text-[13px] font-medium">{label}</div>
				{hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
			</div>
			<div className={cn("shrink-0", stacked && "w-full")}>{children}</div>
		</div>
	);
}
