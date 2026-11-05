// Platform-aware labels. The webview has no Node APIs, so sniff the UA.
export const IS_MAC = navigator.userAgent.includes("Mac");

/** Shortcut label with the platform's primary modifier: ⌘N on macOS, Ctrl+N elsewhere. */
export function mod(key: string): string {
	return IS_MAC ? `⌘${key}` : `Ctrl+${key}`;
}

/** Shift + key label: ⇧Del on macOS, Shift+Del elsewhere. */
export function shift(key: string): string {
	return IS_MAC ? `⇧${key}` : `Shift+${key}`;
}
