import { describe, expect, mock, test } from "bun:test";

mock.module("electrobun/main", () => ({ Utils: { paths: {} } }));
const { deriveStatus, toPublicJob } = await import("./manager");
import type { FileTask, Job } from "./types";

function task(status: FileTask["status"], extra: Partial<FileTask> = {}): FileTask {
	return {
		id: `t_${Math.random()}`,
		key: "0",
		name: "f.mkv",
		relPath: "f.mkv",
		link: "https://hoster.example/secret-link",
		direct: false,
		url: "https://cdn.example/signed?token=SECRET",
		bytesTotal: 100,
		bytesDone: status === "completed" ? 100 : 40,
		speed: status === "active" ? 10 : 0,
		status,
		resumable: true,
		retries: 0,
		...extra,
	};
}

function job(stage: Job["stage"], tasks: FileTask[] = [], extra: Partial<Job> = {}): Job {
	return {
		id: "job_1",
		kind: "magnet",
		name: "Thing",
		accountId: "acc_1",
		provider: "real-debrid",
		stage,
		paused: false,
		dir: "/dl",
		addedAt: new Date(0).toISOString(),
		source: "magnet:?xt=urn:btih:SECRETHASH",
		tasks,
		...extra,
	};
}

describe("job status", () => {
	test("pipeline stages map straight through", () => {
		expect(deriveStatus(job("queued"))).toBe("queued");
		expect(deriveStatus(job("remote"))).toBe("remote");
		expect(deriveStatus(job("failed"))).toBe("failed");
		expect(deriveStatus(job("remote", [], { paused: true }))).toBe("paused");
	});

	test("files stage derives from tasks", () => {
		expect(deriveStatus(job("files", [task("active"), task("completed")]))).toBe("downloading");
		expect(deriveStatus(job("files", [task("queued")]))).toBe("downloading");
		expect(deriveStatus(job("files", [task("completed"), task("completed")]))).toBe("completed");
		expect(deriveStatus(job("files", [task("paused"), task("completed")]))).toBe("paused");
		expect(deriveStatus(job("files", [task("failed"), task("completed")]))).toBe("failed");
	});

	test("public projection sums progress and leaks no links or sources", () => {
		const pub = toPublicJob(job("files", [task("active"), task("failed")]));
		expect(pub.bytesTotal).toBe(200);
		expect(pub.bytesDone).toBe(80);
		expect(pub.speed).toBe(10);
		expect(pub.error).toBe("1 file failed");
		const json = JSON.stringify(pub);
		expect(json).not.toContain("SECRET");
		expect(json).not.toContain("hoster.example");
	});
});
