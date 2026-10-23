// accountId → debrid-ts client. Instances are cached per account and rebuilt
// when the secret changes (token refresh, key edit). OAuth access tokens are
// refreshed shortly before expiry; bad tokens mark the account invalid.
import { AllDebrid, DebridError, Premiumize, RealDebrid } from "debrid-ts";
import {
	loadSettings,
	setAccountStatus,
	updateSettings,
	type AccountMeta,
	type AccountSecret,
} from "../settings";
import type { ProviderId } from "../../shared/rpc-schema";

export type AnyClient = RealDebrid | AllDebrid | Premiumize;

type Cached = { client: AnyClient; token: string };
const cache = new Map<string, Cached>();

export function makeClient(provider: ProviderId, token: string, timeoutSec = 30): AnyClient {
	const opts = { timeout: timeoutSec * 1000, maxRetries: 2 };
	switch (provider) {
		case "real-debrid":
			return new RealDebrid(token, opts);
		case "all-debrid":
			return new AllDebrid(token, opts);
		case "premiumize":
			return new Premiumize(token, opts);
	}
}

function tokenOf(secret: AccountSecret): string {
	return secret.kind === "apikey" ? secret.apiKey : secret.accessToken;
}

async function refreshIfNeeded(
	account: AccountMeta,
	secret: AccountSecret,
): Promise<AccountSecret> {
	if (secret.kind !== "oauth" || secret.expiresAt - Date.now() > 60_000) return secret;
	if (account.provider !== "real-debrid") return secret; // only RD issues refresh tokens here
	const token = await RealDebrid.refreshToken({
		clientId: secret.clientId,
		clientSecret: secret.clientSecret,
		refreshToken: secret.refreshToken,
	});
	const next: AccountSecret = {
		...secret,
		accessToken: token.access_token,
		refreshToken: token.refresh_token || secret.refreshToken,
		expiresAt: Date.now() + token.expires_in * 1000,
	};
	await updateSettings((s) => {
		s.secrets[account.id] = next;
	});
	return next;
}

export class AccountError extends Error {}

/** Resolve a usable client for an account (refreshing OAuth tokens). */
export async function clientFor(
	accountId: string,
): Promise<{ client: AnyClient; account: AccountMeta }> {
	const s = await loadSettings();
	const account = s.accounts.find((a) => a.id === accountId);
	const secret = s.secrets[accountId];
	if (!account || !secret) throw new AccountError("Account not found — it may have been removed");
	let current = secret;
	try {
		current = await refreshIfNeeded(account, secret);
	} catch (err) {
		await markInvalid(accountId, err);
		throw err;
	}
	const token = tokenOf(current);
	const hit = cache.get(accountId);
	if (hit && hit.token === token) return { client: hit.client, account };
	const client = makeClient(account.provider, token, s.advanced.timeoutSec);
	cache.set(accountId, { client, token });
	return { client, account };
}

export function dropClient(accountId: string): void {
	cache.delete(accountId);
}

const AUTH_CODES = new Set([
	"bad_token",
	"AUTH_BAD_APIKEY",
	"AUTH_MISSING_APIKEY",
	"AUTH_USER_BANNED",
	"AUTH_BLOCKED",
	"permission_denied",
]);

export function isAuthError(err: unknown): boolean {
	return (
		err instanceof DebridError &&
		(err.status === 401 ||
			err.status === 403 ||
			(err.code !== undefined && AUTH_CODES.has(err.code)))
	);
}

export async function markInvalid(accountId: string, err: unknown): Promise<void> {
	await updateSettings((s) =>
		setAccountStatus(s, accountId, "invalid", { lastError: errorMessage(err) }),
	);
}

/** Run a call against an account; auth failures flip the account to invalid. */
export async function withClient<T>(
	accountId: string,
	fn: (client: AnyClient, account: AccountMeta) => Promise<T>,
): Promise<T> {
	const { client, account } = await clientFor(accountId);
	try {
		return await fn(client, account);
	} catch (err) {
		if (isAuthError(err)) await markInvalid(accountId, err);
		throw err;
	}
}

const NETWORK_CODES = new Set([
	"ETIMEDOUT",
	"ECONNREFUSED",
	"ECONNRESET",
	"ENOTFOUND",
	"EAI_AGAIN",
	"ENETUNREACH",
	"EHOSTUNREACH",
]);

/** Connection-level failure (never reached the service), as opposed to an API error. */
export function isNetworkError(err: unknown): boolean {
	const e = err as { code?: unknown; name?: string; cause?: { code?: unknown } } | undefined;
	const code = e?.code ?? e?.cause?.code;
	return (typeof code === "string" && NETWORK_CODES.has(code)) || e?.name === "TimeoutError";
}

export function errorMessage(err: unknown): string {
	if (isNetworkError(err))
		return "Couldn't reach the service — check your internet connection and try again";
	if (err instanceof DebridError) {
		return err.code ? `${err.message} (${err.code})` : err.message;
	}
	return err instanceof Error ? err.message : String(err);
}
