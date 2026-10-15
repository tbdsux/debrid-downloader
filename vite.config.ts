import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { electrobunViteAliases } from "./.hutch/devkit/api/config/electrobun-vite";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: [
			{ find: "@", replacement: resolve(__dirname, "src/mainview") },
			...electrobunViteAliases(resolve(__dirname, ".hutch/devkit")),
		],
	},
	root: resolve(__dirname, "src/mainview"),
	build: {
		outDir: resolve(__dirname, "dist"),
		emptyOutDir: true,
	},
	server: {
		port: 5173,
		strictPort: true,
	},
});
