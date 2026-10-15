import { useCallback, useState, type ReactNode } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type ConfirmOpts = {
	title: string;
	description?: ReactNode;
	confirm?: string;
	destructive?: boolean;
	onConfirm: () => void | Promise<void>;
};

/** Imperative confirm dialog: `const [confirm, node] = useConfirm()`; render `node` once. */
export function useConfirm(): [(opts: ConfirmOpts) => void, ReactNode] {
	const [opts, setOpts] = useState<ConfirmOpts | null>(null);
	const ask = useCallback((o: ConfirmOpts) => setOpts(o), []);
	const node = (
		<AlertDialog open={!!opts} onOpenChange={(o) => !o && setOpts(null)}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{opts?.title}</AlertDialogTitle>
					{opts?.description && <AlertDialogDescription>{opts.description}</AlertDialogDescription>}
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
						variant={opts?.destructive ? "destructive" : "default"}
						onClick={async () => {
							const o = opts;
							setOpts(null);
							await o?.onConfirm();
						}}
					>
						{opts?.confirm ?? "Confirm"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
	return [ask, node];
}
