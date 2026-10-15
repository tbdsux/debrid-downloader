// Settings store checks. Run: bun test src/bun
// Stubs only the electrobun SDK (not available outside hutch builds);
// minicrypt encryption runs for real against a temp dir.
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = mkdtempSync(join(tmpdir(), "dd-settings-test-"));
const USER_DATA = join(ROOT, "userData");
const LEGACY = join(ROOT, "config");

mock.module("electrobun/main", () => ({
	Utils: {
		paths: {
			userData: USER_DATA,
			config: LEGACY,
			downloads: join(ROOT, "Downloads"),
			home: ROOT,
		},
	},
}));

const { loadSettings, updateSettings, toPublic, _resetCache } = await import("./settings");
const { clampConcurrent } = await import("../shared/rpc-schema");
const { encrypt } = await import("minicrypt/xchacha20-poly1305");

afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

describe("settings store", () => {
	beforeEach(() => {
		rmSync(USER_DATA, { recursive: true, force: true });
		_resetCache();
	});

	test("defaults: OS downloads dir, no accounts", async () => {
		const s = await loadSettings();
		expect(s.downloads.dir).toBe(join(ROOT, "Downloads"));
		expect(s.accounts).toEqual([]);
		expect(s.general.pollSeconds).toBe(5);
	});

	test("secrets are encrypted at rest and never in the public projection", async () => {
		await updateSettings((s) => {
			s.accounts.push({
				id: "acc_1",
				provider: "real-debrid",
				label: "main",
				auth: "apikey",
				hint: "T123",
				status: "ok",
				addedAt: new Date().toISOString(),
			});
			s.secrets.acc_1 = { kind: "apikey", apiKey: "SECRET-TOKEN-T123" };
		});
		const raw = readFileSync(join(USER_DATA, "settings.json"), "utf8");
		expect(raw).not.toContain("SECRET-TOKEN");
		expect(typeof JSON.parse(raw).secrets).toBe("string");

		_resetCache();
		const loaded = await loadSettings();
		expect(loaded.secrets.acc_1).toEqual({ kind: "apikey", apiKey: "SECRET-TOKEN-T123" });
		expect(loaded.defaultAccountId).toBe("acc_1");
		expect(JSON.stringify(toPublic(loaded))).not.toContain("SECRET-TOKEN");
	});

	test("~ in the download dir is expanded and values are clamped", async () => {
		const s = await updateSettings((st) => {
			st.downloads.dir = "~/Media";
			st.downloads.concurrent = 99;
			st.general.pollSeconds = 1;
		});
		expect(s.downloads.dir).toBe(join(ROOT, "Media"));
		expect(s.downloads.concurrent).toBe(8);
		expect(s.general.pollSeconds).toBe(5);
	});

	test("v1 file migrates to one account per provider key", async () => {
		const { mkdirSync } = await import("node:fs");
		mkdirSync(USER_DATA, { recursive: true });
		const secret = "a".repeat(64);
		writeFileSync(join(USER_DATA, "settings.key"), secret);
		const keys = await encrypt({
			key: secret,
			data: JSON.stringify({ "Real-Debrid": "RDKEY1234", TorBox: "dropped", AllDebrid: "" }),
		});
		writeFileSync(
			join(USER_DATA, "settings.json"),
			JSON.stringify({
				version: 1,
				order: ["TorBox", "Real-Debrid", "AllDebrid"],
				downloads: { dir: "/tmp/dl", concurrent: 5 },
				keys,
			}),
		);
		const s = await loadSettings();
		expect(s.accounts.map((a) => a.provider)).toEqual(["real-debrid"]);
		expect(s.accounts[0]!.hint).toBe("1234");
		expect(s.secrets[s.accounts[0]!.id]).toEqual({ kind: "apikey", apiKey: "RDKEY1234" });
		expect(s.downloads).toMatchObject({ dir: "/tmp/dl", concurrent: 5 });
		expect(JSON.parse(readFileSync(join(USER_DATA, "settings.json"), "utf8")).version).toBe(2);
	});

	test("corrupt file falls back to defaults instead of throwing", async () => {
		const { mkdirSync } = await import("node:fs");
		mkdirSync(USER_DATA, { recursive: true });
		writeFileSync(join(USER_DATA, "settings.json"), "{not json");
		const s = await loadSettings();
		expect(s.accounts).toEqual([]);
	});

	test("legacy files in the OS config dir are moved to userData", async () => {
		const { mkdirSync } = await import("node:fs");
		mkdirSync(LEGACY, { recursive: true });
		writeFileSync(join(LEGACY, "settings.key"), "b".repeat(64));
		writeFileSync(join(LEGACY, "settings.json"), JSON.stringify({ version: 2, accounts: [] }));
		// paths.ts migrates once per process; re-import a fresh copy.
		const paths = await import(`./paths?fresh=${Date.now()}`);
		paths.dataDir();
		expect(existsSync(join(USER_DATA, "settings.json"))).toBe(true);
		expect(existsSync(join(LEGACY, "settings.json"))).toBe(false);
	});

	test("clampConcurrent bounds 1..8", () => {
		expect(clampConcurrent(99)).toBe(8);
		expect(clampConcurrent(0)).toBe(1);
		expect(clampConcurrent(3.7)).toBe(4);
		expect(clampConcurrent(Number("abc"))).toBe(1);
	});
});
