// Main-process settings persistence. Owns <userData>/settings.json:
// plaintext for preferences + account metadata, account secrets encrypted at
// rest via minicrypt (XChaCha20-Poly1305) with an auto-generated secret in
// settings.key. Secrets never leave this process — the view gets masked hints.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { decrypt, encrypt } from "minicrypt/xchacha20-poly1305";
import { dataDir, keyFile, resolveDir, settingsFile } from "./paths";
import {
	clampConcurrent,
	clampInt,
	isProviderId,
	type AccountPublic,
	type AccountStatus,
	type AdvancedSettings,
	type DownloadsSettings,
	type GeneralSettings,
	type ProviderId,
	type PublicSettings,
} from "../shared/rpc-schema";

export type AccountSecret =
	| { kind: "apikey"; apiKey: string }
	| {
			kind: "oauth";
			accessToken: string;
			refreshToken: string;
			clientId: string;
			clientSecret: string;
			/** epoch ms */
			expiresAt: number;
	  };

export type AccountMeta = Omit<AccountPublic, "isDefault">;

/** Full in-memory state (main process only). */
export type SettingsState = {
	accounts: AccountMeta[];
	defaultAccountId: string | null;
	downloads: DownloadsSettings;
	general: GeneralSettings;
	advanced: AdvancedSettings;
	secrets: Record<string, AccountSecret>;
};

type StoredV2 = {
	version: 2;
	accounts: AccountMeta[];
	defaultAccountId: string | null;
	downloads: Partial<DownloadsSettings>;
	general: Partial<GeneralSettings>;
	advanced: Partial<AdvancedSettings>;
	/** minicrypt ciphertext of JSON.stringify(Record<accountId, AccountSecret>) */
	secrets?: string;
};

type StoredV1 = {
	version: 1;
	order?: string[];
	downloads?: { dir?: string; concurrent?: number };
	keys?: string;
};

const V1_PROVIDER_IDS: Record<string, ProviderId> = {
	"Real-Debrid": "real-debrid",
	AllDebrid: "all-debrid",
	Premiumize: "premiumize",
};

let cachedSecret: string | undefined;

/** Bootstrap-once encryption secret (64 hex chars). Created on first use. */
function getSecret(): string {
	if (!cachedSecret) {
		if (existsSync(keyFile())) {
			cachedSecret = readFileSync(keyFile(), "utf8").trim();
		} else {
			cachedSecret = randomBytes(32).toString("hex");
			dataDir();
			writeFileSync(keyFile(), cachedSecret, { mode: 0o600 });
		}
	}
	return cachedSecret;
}

export function newId(prefix: string): string {
	return `${prefix}_${randomBytes(6).toString("hex")}`;
}

export function hintFor(secret: string): string {
	return secret.length > 4 ? secret.slice(-4) : "";
}

function normDownloads(d: Partial<DownloadsSettings> | undefined): DownloadsSettings {
	return {
		dir: resolveDir(d?.dir),
		concurrent: clampConcurrent(Number(d?.concurrent ?? 3)),
		speedLimit: clampInt(d?.speedLimit, 0, 10_000_000, 0),
		subfolder: d?.subfolder ?? true,
		conflict: d?.conflict === "overwrite" || d?.conflict === "skip" ? d.conflict : "rename",
		retries: clampInt(d?.retries, 0, 10, 3),
	};
}

function normGeneral(g: Partial<GeneralSettings> | undefined): GeneralSettings {
	return {
		theme: g?.theme === "light" || g?.theme === "dark" ? g.theme : "system",
		clipboard: g?.clipboard ?? true,
		notify: g?.notify ?? true,
		deleteAfter: g?.deleteAfter ?? false,
		pollSeconds: clampInt(g?.pollSeconds, 5, 60, 5),
	};
}

function normAdvanced(a: Partial<AdvancedSettings> | undefined): AdvancedSettings {
	return { timeoutSec: clampInt(a?.timeoutSec, 5, 120, 30) };
}

function normAccounts(list: unknown): AccountMeta[] {
	if (!Array.isArray(list)) return [];
	const seen = new Set<string>();
	return list.filter((a): a is AccountMeta => {
		if (!a || typeof a !== "object") return false;
		const ok = typeof a.id === "string" && isProviderId(a.provider) && !seen.has(a.id);
		if (ok) seen.add(a.id);
		return ok;
	});
}

export function defaults(): SettingsState {
	return {
		accounts: [],
		defaultAccountId: null,
		downloads: normDownloads(undefined),
		general: normGeneral(undefined),
		advanced: normAdvanced(undefined),
		secrets: {},
	};
}

async function decryptJson<T>(data: string): Promise<T> {
	return JSON.parse(await decrypt({ key: getSecret(), data })) as T;
}

/** v1 (one key per provider name) → v2 (accounts). */
async function migrateV1(raw: StoredV1): Promise<SettingsState> {
	const keys = raw.keys ? await decryptJson<Record<string, string>>(raw.keys) : {};
	const state = defaults();
	state.downloads = normDownloads(raw.downloads);
	const order = Array.isArray(raw.order) ? raw.order : Object.keys(keys);
	for (const name of order) {
		const provider = V1_PROVIDER_IDS[name];
		const key = (keys[name] ?? "").trim();
		if (!provider || !key) continue;
		const id = newId("acc");
		state.accounts.push({
			id,
			provider,
			label: "default",
			auth: "apikey",
			hint: hintFor(key),
			status: "unknown",
			addedAt: new Date().toISOString(),
		});
		state.secrets[id] = { kind: "apikey", apiKey: key };
	}
	state.defaultAccountId = state.accounts[0]?.id ?? null;
	return state;
}

let state: SettingsState | undefined;

export async function loadSettings(): Promise<SettingsState> {
	if (state) return state;
	try {
		const raw = JSON.parse(readFileSync(settingsFile(), "utf8")) as StoredV1 | StoredV2;
		if (raw.version === 2) {
			const secrets = raw.secrets
				? await decryptJson<Record<string, AccountSecret>>(raw.secrets)
				: {};
			const accounts = normAccounts(raw.accounts);
			state = {
				accounts,
				defaultAccountId: accounts.some((a) => a.id === raw.defaultAccountId)
					? raw.defaultAccountId
					: (accounts[0]?.id ?? null),
				downloads: normDownloads(raw.downloads),
				general: normGeneral(raw.general),
				advanced: normAdvanced(raw.advanced),
				secrets: secrets && typeof secrets === "object" ? secrets : {},
			};
		} else {
			state = await migrateV1(raw);
			await persist(state);
			console.log(`[settings] migrated v1 → v2 (${state.accounts.length} account(s))`);
		}
	} catch (err) {
		if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
			// Corrupt JSON or undecryptable secrets (e.g. settings.key deleted) —
			// start fresh rather than crash; next save rewrites both consistently.
			console.warn("[settings] load failed, using defaults:", err);
		}
		state = defaults();
	}
	return state;
}

async function persist(s: SettingsState): Promise<void> {
	const stored: StoredV2 = {
		version: 2,
		accounts: s.accounts,
		defaultAccountId: s.defaultAccountId,
		downloads: s.downloads,
		general: s.general,
		advanced: s.advanced,
		secrets: await encrypt({ key: getSecret(), data: JSON.stringify(s.secrets) }),
	};
	const file = settingsFile();
	const tmp = file + ".tmp";
	writeFileSync(tmp, JSON.stringify(stored, null, "\t"), { mode: 0o600 });
	renameSync(tmp, file);
}

const listeners = new Set<(s: SettingsState) => void>();
export function onSettingsChanged(fn: (s: SettingsState) => void): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

let writing: Promise<void> = Promise.resolve();

/** Apply a mutation to the in-memory state and persist (writes serialized). */
export async function updateSettings(mutate: (s: SettingsState) => void): Promise<SettingsState> {
	const s = await loadSettings();
	mutate(s);
	s.downloads = normDownloads(s.downloads);
	s.general = normGeneral(s.general);
	s.advanced = normAdvanced(s.advanced);
	if (!s.accounts.some((a) => a.id === s.defaultAccountId)) {
		s.defaultAccountId = s.accounts[0]?.id ?? null;
	}
	const run = writing.then(() => persist(s));
	writing = run.catch(() => {});
	await run;
	for (const fn of listeners) fn(s);
	return s;
}

export async function resetPreferences(): Promise<SettingsState> {
	return updateSettings((s) => {
		const d = defaults();
		s.downloads = d.downloads;
		s.general = d.general;
		s.advanced = d.advanced;
	});
}

export function setAccountStatus(
	s: SettingsState,
	id: string,
	status: AccountStatus,
	extra: Partial<AccountMeta> = {},
): void {
	const a = s.accounts.find((x) => x.id === id);
	if (a) Object.assign(a, extra, { status });
}

export function toPublic(s: SettingsState): PublicSettings {
	return {
		accounts: s.accounts.map((a) => ({ ...a, isDefault: a.id === s.defaultAccountId })),
		defaultAccountId: s.defaultAccountId,
		downloads: s.downloads,
		general: s.general,
		advanced: s.advanced,
		configDir: dataDir(),
	};
}

/** Test hook: drop the in-memory cache so the next load reads disk. */
export function _resetCache(): void {
	state = undefined;
	cachedSecret = undefined;
}
