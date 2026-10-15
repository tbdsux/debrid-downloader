// Settings + accounts data layer. One query; every save RPC returns the
// fresh PublicSettings, and main-side changes (token refresh, invalid
// account) arrive via the settingsChanged push — so no polling.
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errText, onPush, rpc } from "./rpc";
import type {
	AdvancedSettings,
	DownloadsSettings,
	GeneralSettings,
	ProviderId,
	PublicSettings,
} from "../../shared/rpc-schema";

export const SETTINGS_KEY = ["settings"] as const;

export function useSettings() {
	const qc = useQueryClient();
	useEffect(() => onPush("settingsChanged", (s) => qc.setQueryData(SETTINGS_KEY, s)), [qc]);
	return useQuery({
		queryKey: SETTINGS_KEY,
		queryFn: () => rpc.request.getSettings(),
		staleTime: Infinity,
	});
}

function useSave<IV>(mutationFn: (input: IV) => Promise<PublicSettings>, success?: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn,
		onSuccess: (settings) => {
			qc.setQueryData(SETTINGS_KEY, settings);
			if (success) toast.success(success);
		},
		onError: (err) => toast.error(errText(err)),
	});
}

export const useSaveDownloadOpts = () =>
	useSave((p: Partial<DownloadsSettings>) => rpc.request.saveDownloadOpts(p));
export const useSaveGeneral = () =>
	useSave((p: Partial<GeneralSettings>) => rpc.request.saveGeneral(p));
export const useSaveAdvanced = () =>
	useSave((p: Partial<AdvancedSettings>) => rpc.request.saveAdvanced(p));
export const useResetSettings = () =>
	useSave(() => rpc.request.resetSettings(), "Preferences reset to defaults");

export function useAddAccountWithKey() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (p: { provider: ProviderId; label: string; apiKey: string }) =>
			rpc.request.addAccountWithKey(p),
		onSuccess: (s) => qc.setQueryData(SETTINGS_KEY, s),
	});
}

export const useUpdateAccount = () =>
	useSave((p: { id: string; label?: string; isDefault?: boolean; apiKey?: string }) =>
		rpc.request.updateAccount(p),
	);
export const useReorderAccounts = () =>
	useSave((ids: string[]) => rpc.request.reorderAccounts({ ids }));
export const useRemoveAccount = () =>
	useSave((id: string) => rpc.request.removeAccount({ id }), "Account removed");
export const useRefreshAccount = () =>
	useSave((id: string) => rpc.request.refreshAccount({ id }));

/** Native folder picker (main process). Resolves null when cancelled. */
export function pickFolder(startingFolder?: string): Promise<string | null> {
	return rpc.request.pickFolder({ startingFolder });
}
