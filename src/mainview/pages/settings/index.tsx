import { Link, useRoute } from "wouter";
import { DownloadIcon, SlidersHorizontalIcon, UsersIcon, WrenchIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSettings } from "@/lib/use-settings";
import AccountsSection from "./accounts";
import DownloadsSection from "./downloads";
import GeneralSection from "./general";
import AdvancedSection from "./advanced";

const SECTIONS = [
	{ path: "/settings", label: "Accounts", icon: UsersIcon, component: AccountsSection },
	{
		path: "/settings/downloads",
		label: "Downloads",
		icon: DownloadIcon,
		component: DownloadsSection,
	},
	{
		path: "/settings/general",
		label: "General",
		icon: SlidersHorizontalIcon,
		component: GeneralSection,
	},
	{ path: "/settings/advanced", label: "Advanced", icon: WrenchIcon, component: AdvancedSection },
] as const;

export default function SettingsPage() {
	const [match, params] = useRoute("/settings/:section");
	const { data: settings } = useSettings();
	const current =
		(match && SECTIONS.find((s) => s.path === `/settings/${params.section}`)) || SECTIONS[0];
	const Section = current.component;
	const invalid = settings?.accounts.some((a) => a.status === "invalid");

	return (
		<div className="flex h-full min-h-0">
			<nav className="flex w-52 shrink-0 flex-col gap-px border-r bg-chrome/60 p-2">
				{SECTIONS.map((s) => (
					<Link
						key={s.path}
						href={s.path}
						className={cn(
							"flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] transition-colors [&_svg]:size-4",
							current.path === s.path
								? "bg-primary/12 font-medium text-foreground [&_svg]:text-primary"
								: "text-foreground/80 hover:bg-accent [&_svg]:text-muted-foreground",
						)}
					>
						<s.icon />
						{s.label}
						{s.label === "Accounts" && invalid && (
							<span
								className="ml-auto size-2 rounded-full bg-destructive"
								title="An account needs attention"
							/>
						)}
					</Link>
				))}
			</nav>
			<div className="min-w-0 flex-1 overflow-auto">
				<div className="mx-auto max-w-3xl px-6 py-5">{settings && <Section />}</div>
			</div>
		</div>
	);
}
