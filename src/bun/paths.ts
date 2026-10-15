// App-scoped file locations. Utils.paths.config is the OS-wide config dir
// (~/.config, ~/Library/Application Support, %APPDATA%), so earlier builds
// wrote settings.json/settings.key loose into it. userData is per-app.
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { Utils } from "electrobun/main";

let migrated = false;

/** App data dir (recreated if deleted); migrates legacy files once. */
export function dataDir(): string {
	const dir = Utils.paths.userData;
	mkdirSync(dir, { recursive: true });
	if (!migrated) {
		migrated = true;
		migrateLegacy(dir);
	}
	return dir;
}

export const settingsFile = () => join(dataDir(), "settings.json");
export const keyFile = () => join(dataDir(), "settings.key");
export const jobsFile = () => join(dataDir(), "jobs.json");
export const torrentsDir = () => {
	const d = join(dataDir(), "torrents");
	mkdirSync(d, { recursive: true });
	return d;
};

function migrateLegacy(dir: string) {
	const legacy = Utils.paths.config;
	if (legacy === dir) return;
	for (const name of ["settings.json", "settings.key"]) {
		const from = join(legacy, name);
		const to = join(dir, name);
		// Only move the pair we recognise; settings.json without settings.key
		// could be some other app's file, so require the key file to exist.
		if (existsSync(from) && !existsSync(to) && existsSync(join(legacy, "settings.key"))) {
			try {
				renameSync(from, to);
				console.log(`[paths] migrated ${from} → ${to}`);
			} catch (err) {
				console.warn(`[paths] could not migrate ${from}:`, err);
			}
		}
	}
}

/** Expand a leading ~ and fall back to the OS Downloads dir. */
export function resolveDir(dir: unknown): string {
	if (typeof dir !== "string" || dir.trim() === "") return Utils.paths.downloads;
	const d = dir.trim();
	if (d === "~") return Utils.paths.home;
	if (d.startsWith("~/")) return join(Utils.paths.home, d.slice(2));
	return d;
}
