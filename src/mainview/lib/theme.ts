import { useEffect } from "react";
import type { ThemeMode } from "../../shared/rpc-schema";

/** Toggle the `.dark` class on <html> from the theme setting (system follows the OS). */
export function useApplyTheme(mode: ThemeMode | undefined) {
	useEffect(() => {
		const mq = window.matchMedia("(prefers-color-scheme: dark)");
		const apply = () => {
			const dark = mode === "dark" || ((mode ?? "system") === "system" && mq.matches);
			document.documentElement.classList.toggle("dark", dark);
		};
		apply();
		mq.addEventListener("change", apply);
		return () => mq.removeEventListener("change", apply);
	}, [mode]);
}

export function isDark(): boolean {
	return document.documentElement.classList.contains("dark");
}
