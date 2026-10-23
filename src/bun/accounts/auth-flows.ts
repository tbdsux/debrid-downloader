// Interactive sign-in flows. We poll the single-shot endpoints ourselves
// (instead of debrid-ts' waitFor* helpers) so a flow can be cancelled when
// the user closes the dialog.
import { AllDebrid, RealDebrid, REAL_DEBRID_OPENSOURCE_CLIENT_ID } from "debrid-ts";
import { addAccount, fetchUser } from "./store";
import { errorMessage } from "./clients";
import { newId, type SettingsState } from "../settings";
import type { AuthFlowStart, ProviderId } from "../../shared/rpc-schema";

type Flow = { cancelled: boolean };
const flows = new Map<string, Flow>();

export type FlowDone = (r: {
	flowId: string;
	ok: boolean;
	state?: SettingsState;
	accountId?: string;
	error?: string;
}) => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function startAuthFlow(
	provider: ProviderId,
	label: string,
	done: FlowDone,
): Promise<AuthFlowStart> {
	const flowId = newId("flow");
	const flow: Flow = { cancelled: false };
	flows.set(flowId, flow);

	let start: AuthFlowStart;
	let poll: () => Promise<SettingsState | null>;

	if (provider === "real-debrid") {
		const code = await RealDebrid.getDeviceCode(undefined, { newCredentials: true });
		start = {
			flowId,
			userCode: code.user_code,
			verifyUrl: code.direct_verification_url || code.verification_url,
			expiresIn: code.expires_in,
		};
		let creds: { client_id: string; client_secret: string } | undefined;
		poll = async () => {
			if (!creds) {
				try {
					creds = await RealDebrid.getDeviceCredentials({
						clientId: REAL_DEBRID_OPENSOURCE_CLIENT_ID,
						deviceCode: code.device_code,
					});
				} catch {
					return null; // not approved yet
				}
			}
			const token = await RealDebrid.getDeviceToken({
				clientId: creds.client_id,
				clientSecret: creds.client_secret,
				deviceCode: code.device_code,
			});
			const user = await fetchUser(provider, token.access_token);
			return addAccount(
				provider,
				label,
				{
					kind: "oauth",
					accessToken: token.access_token,
					refreshToken: token.refresh_token,
					clientId: creds.client_id,
					clientSecret: creds.client_secret,
					expiresAt: Date.now() + token.expires_in * 1000,
				},
				user,
			);
		};
		runPoll(flowId, flow, Math.max(code.interval, 3), code.expires_in, poll, done);
		return start;
	}

	if (provider === "all-debrid") {
		const pin = await AllDebrid.getPin();
		start = { flowId, userCode: pin.pin, verifyUrl: pin.user_url, expiresIn: pin.expires_in };
		poll = async () => {
			const res = (await AllDebrid.checkPin({ check: pin.check, pin: pin.pin })) as {
				activated: boolean;
				apikey?: string;
			};
			if (!res.activated || !res.apikey) return null;
			const user = await fetchUser(provider, res.apikey);
			return addAccount(provider, label, { kind: "apikey", apiKey: res.apikey }, user);
		};
		runPoll(flowId, flow, 5, pin.expires_in, poll, done);
		return start;
	}

	flows.delete(flowId);
	throw new Error("Sign-in isn't available for this service — paste an API key instead");
}

function runPoll(
	flowId: string,
	flow: Flow,
	intervalSec: number,
	expiresSec: number,
	poll: () => Promise<SettingsState | null>,
	done: FlowDone,
) {
	const deadline = Date.now() + expiresSec * 1000;
	void (async () => {
		let lastError = "";
		while (!flow.cancelled && Date.now() < deadline) {
			await sleep(intervalSec * 1000);
			if (flow.cancelled) break;
			try {
				const state = await poll();
				if (state) {
					flows.delete(flowId);
					const accountId = state.accounts[state.accounts.length - 1]?.id;
					done({ flowId, ok: true, state, accountId });
					return;
				}
			} catch (err) {
				lastError = errorMessage(err);
				// Pending states surface as errors on some endpoints — keep polling.
			}
		}
		flows.delete(flowId);
		if (!flow.cancelled) {
			done({
				flowId,
				ok: false,
				error: lastError ? `Sign-in expired (${lastError})` : "Sign-in code expired",
			});
		}
	})();
}

export function cancelAuthFlow(flowId: string): void {
	const f = flows.get(flowId);
	if (f) f.cancelled = true;
	flows.delete(flowId);
}
