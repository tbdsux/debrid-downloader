import { createContext, useContext } from "react";

export type AddTab = "magnet" | "torrent" | "link";
export type AddPrefill = {
	tab?: AddTab;
	text?: string;
	files?: { name: string; base64: string }[];
};

export const AddDialogContext = createContext<(prefill?: AddPrefill) => void>(() => {});

/** Open the global Add dialog, optionally prefilled. */
export function useOpenAdd() {
	return useContext(AddDialogContext);
}

/** Guess which tab a pasted string belongs to. */
export function tabFor(text: string): AddTab {
	return /^\s*(magnet:\?|[a-f0-9]{40}\s*$)/i.test(text) ? "magnet" : "link";
}
