// Provider metadata shared by both sides. Ids match debrid-ts client `name`s.
// Adding a provider (e.g. TorBox once debrid-ts ships it) = one entry here +
// one case in src/bun/accounts/clients.ts.

export const PROVIDER_IDS = ["real-debrid", "all-debrid", "premiumize"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export type ProviderCapabilities = {
	/** Sign-in via device code / PIN (otherwise API key only). */
	signIn: boolean;
	/** Link history (RD /downloads, AD saved history). */
	history: boolean;
	/** Cloud file/folder browser (PM). */
	files: boolean;
	/** Side-effect-free cache lookup (PM only — RD/AD probe by adding). */
	realCacheCheck: boolean;
};

export type ProviderInfo = {
	id: ProviderId;
	name: string;
	/** 2-letter badge text */
	short: string;
	/** Where the user gets an API key */
	keyUrl: string;
	caps: ProviderCapabilities;
};

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
	"real-debrid": {
		id: "real-debrid",
		name: "Real-Debrid",
		short: "RD",
		keyUrl: "https://real-debrid.com/apitoken",
		caps: { signIn: true, history: true, files: false, realCacheCheck: false },
	},
	"all-debrid": {
		id: "all-debrid",
		name: "AllDebrid",
		short: "AD",
		keyUrl: "https://alldebrid.com/apikeys/",
		caps: { signIn: true, history: true, files: false, realCacheCheck: false },
	},
	premiumize: {
		id: "premiumize",
		name: "Premiumize",
		short: "PM",
		keyUrl: "https://www.premiumize.me/account",
		// PM device flow needs a registered client id; none is public, so key only.
		caps: { signIn: false, history: false, files: true, realCacheCheck: true },
	},
};

export function isProviderId(v: unknown): v is ProviderId {
	return typeof v === "string" && (PROVIDER_IDS as readonly string[]).includes(v);
}
