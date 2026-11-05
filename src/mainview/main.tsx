import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Electroview } from "electrobun/view";
import "./index.css";
import App from "./App";
import { rpc } from "./lib/rpc";

// Connect to the main process once at startup (never per component).
// oxlint-disable-next-line no-new -- the instance wires itself to the native bridge
new Electroview({ rpc });

const queryClient = new QueryClient({
	defaultOptions: {
		queries: { retry: 1, refetchOnWindowFocus: false },
	},
});

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<App />
		</QueryClientProvider>
	</StrictMode>,
);
