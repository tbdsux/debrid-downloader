// Account CRUD over the settings store. Every key is validated with
// getUser() before it's saved, so invalid keys never make it to disk.
import {
	hintFor,
	loadSettings,
	newId,
	setAccountStatus,
	updateSettings,
	type AccountMeta,
	type AccountSecret,
	type SettingsState,
} from "../settings";
import {
	dropClient,
	errorMessage,
	isAuthError,
	isNetworkError,
	makeClient,
	withClient,
} from "./clients";
import type { ProviderId } from "../../shared/rpc-schema";
import type { UserInfo } from "debrid-ts";

function userFields(u: UserInfo): Partial<AccountMeta> {
	return {
		username: u.username,
		premium: u.premium,
		expiresAt: u.expiresAt ? u.expiresAt.toISOString() : null,
		lastError: undefined,
	};
}

/** Validate a token by fetching the user; throws a readable error. */
export async function fetchUser(provider: ProviderId, token: string): Promise<UserInfo> {
	const s = await loadSettings();
	try {
		return await makeClient(provider, token, s.advanced.timeoutSec).getUser();
	} catch (err) {
		if (isAuthError(err)) throw new Error("The service rejected this key. Check it and try again.");
		if (isNetworkError(err)) throw new Error(errorMessage(err));
		throw new Error(`Could not verify the account: ${errorMessage(err)}`);
	}
}

export async function addAccount(
	provider: ProviderId,
	label: string,
	secret: AccountSecret,
	user: UserInfo,
): Promise<SettingsState> {
	const token = secret.kind === "apikey" ? secret.apiKey : secret.accessToken;
	return updateSettings((s) => {
		const id = newId("acc");
		const sameService = s.accounts.filter((a) => a.provider === provider).length;
		s.accounts.push({
			id,
			provider,
			label: label.trim() || (sameService ? `account ${sameService + 1}` : "main"),
			auth: secret.kind,
			hint: hintFor(secret.kind === "apikey" ? token : secret.refreshToken || token),
			status: "ok",
			addedAt: new Date().toISOString(),
			...userFields(user),
		});
		s.secrets[id] = secret;
		if (!s.defaultAccountId) s.defaultAccountId = id;
	});
}

export async function addAccountWithKey(
	provider: ProviderId,
	label: string,
	apiKey: string,
): Promise<SettingsState> {
	const key = apiKey.trim();
	if (!key) throw new Error("Enter an API key");
	const user = await fetchUser(provider, key);
	return addAccount(provider, label, { kind: "apikey", apiKey: key }, user);
}

export async function updateAccount(params: {
	id: string;
	label?: string;
	isDefault?: boolean;
	apiKey?: string;
}): Promise<SettingsState> {
	const s = await loadSettings();
	const acc = s.accounts.find((a) => a.id === params.id);
	if (!acc) throw new Error("Account not found");
	let user: UserInfo | undefined;
	const key = params.apiKey?.trim();
	if (key) user = await fetchUser(acc.provider, key);
	dropClient(acc.id);
	return updateSettings((st) => {
		const a = st.accounts.find((x) => x.id === params.id);
		if (!a) return;
		if (params.label !== undefined && params.label.trim()) a.label = params.label.trim();
		if (params.isDefault) st.defaultAccountId = a.id;
		if (key && user) {
			st.secrets[a.id] = { kind: "apikey", apiKey: key };
			a.auth = "apikey";
			a.hint = hintFor(key);
			a.status = "ok";
			Object.assign(a, userFields(user));
		}
	});
}

export async function reorderAccounts(ids: string[]): Promise<SettingsState> {
	return updateSettings((s) => {
		const pos = new Map(ids.map((id, i) => [id, i]));
		s.accounts.sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
	});
}

export async function removeAccount(id: string): Promise<SettingsState> {
	dropClient(id);
	return updateSettings((s) => {
		s.accounts = s.accounts.filter((a) => a.id !== id);
		delete s.secrets[id];
	});
}

export async function refreshAccount(id: string): Promise<SettingsState> {
	try {
		const user = await withClient(id, (c) => c.getUser());
		return updateSettings((s) => setAccountStatus(s, id, "ok", userFields(user)));
	} catch (err) {
		// withClient already flipped auth failures to invalid; surface others.
		if (!isAuthError(err)) {
			await updateSettings((s) => {
				const a = s.accounts.find((x) => x.id === id);
				if (a) a.lastError = errorMessage(err);
			});
		}
		return loadSettings();
	}
}

/** Pick the account for "auto": default first, then priority order, skipping invalid. */
export async function resolveAccountId(requested: string): Promise<string> {
	const s = await loadSettings();
	if (requested !== "auto") {
		if (!s.accounts.some((a) => a.id === requested)) throw new Error("Account not found");
		return requested;
	}
	const usable = s.accounts.filter((a) => a.status !== "invalid");
	const pick = usable.find((a) => a.id === s.defaultAccountId) ?? usable[0] ?? s.accounts[0];
	if (!pick) throw new Error("Add a debrid account in Settings → Accounts first");
	return pick.id;
}
