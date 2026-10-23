export default {
	scripts: {
		install: ["hutch", "install", "--frozen-lockfile"],
		start: "hutch electrobun prepare && hutch pm exec -- vite build && hutch electrobun dev",
		dev: "hutch electrobun prepare && hutch pm exec -- vite build && hutch electrobun dev --watch",
		"dev:hmr": ["hutch", "pm", "exec", "--", "concurrently", "hutch run hmr", "hutch run start"],
		hmr: "hutch electrobun prepare && hutch pm exec -- vite --port 5173",
		build:
			"hutch electrobun prepare && hutch pm exec -- vite build && hutch electrobun build --env=stable",
		"build:canary":
			"hutch electrobun prepare && hutch pm exec -- vite build && hutch electrobun build --env=canary",
		lint: "hutch pm exec -- oxlint",
		"lint:fix": "hutch pm exec -- oxlint --fix",
		fmt: "hutch pm exec -- oxfmt",
		"fmt:check": "hutch pm exec -- oxfmt --check",
	},
	electrobun: {
		version: "2.0.2",
	},
};
