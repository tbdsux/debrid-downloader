// Typed RPC client for the webview side. Schema is shared with the main
// process — outgoing requests are typed from AppRpcSchema["bun"]["requests"].
// Main → view pushes (webview.messages) are re-broadcast on a tiny event bus
// so hooks can subscribe/unsubscribe. Instantiate Electroview once in main.tsx.
import { Electroview } from "electrobun/view";
import type { AppRpcSchema } from "../../shared/rpc-schema";

type Pushes = AppRpcSchema["webview"]["messages"];
type Listener<K extends keyof Pushes> = (payload: Pushes[K]) => void;

// Keyed by push name; typed at the onPush/emit boundary.
const listeners = new Map<keyof Pushes, Set<(payload: never) => void>>();

function emit<K extends keyof Pushes>(name: K, payload: Pushes[K]) {
	for (const fn of listeners.get(name) ?? []) (fn as Listener<K>)(payload);
}

export function onPush<K extends keyof Pushes>(name: K, fn: Listener<K>): () => void {
	let set = listeners.get(name);
	if (!set) listeners.set(name, (set = new Set()));
	const s = set;
	s.add(fn as (payload: never) => void);
	return () => {
		s.delete(fn as (payload: never) => void);
	};
}

export const rpc = Electroview.defineRPC<AppRpcSchema>({
	maxRequestTime: 60_000,
	handlers: {
		requests: {},
		messages: {
			jobsChanged: (p) => emit("jobsChanged", p),
			authFlowResult: (p) => emit("authFlowResult", p),
			settingsChanged: (p) => emit("settingsChanged", p),
			notify: (p) => emit("notify", p),
		},
	},
});

/** RPC errors arrive as Error-ish values; normalize for toasts. */
export function errText(err: unknown): string {
	if (err instanceof Error) return err.message;
	if (typeof err === "string") return err;
	return "Something went wrong";
}
