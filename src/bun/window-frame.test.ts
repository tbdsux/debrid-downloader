import { describe, expect, test } from "bun:test";
import { DEFAULT_FRAME, fitFrame } from "./window-frame";

const screen = { x: 0, y: 0, width: 1920, height: 1080 };

describe("fitFrame", () => {
	test("keeps a valid frame that is on screen", () => {
		const f = { x: 100, y: 80, width: 1200, height: 800 };
		expect(fitFrame(f, [screen])).toEqual(f);
	});

	test("malformed or too small falls back to defaults", () => {
		expect(fitFrame(undefined, [screen])).toEqual(DEFAULT_FRAME);
		expect(fitFrame({ x: "a", y: 0, width: 900, height: 600 }, [screen])).toEqual(DEFAULT_FRAME);
		expect(fitFrame({ x: 0, y: 0, width: 200, height: 100 }, [screen])).toEqual(DEFAULT_FRAME);
	});

	test("off-screen frame (unplugged monitor) is centered on the first display", () => {
		const f = fitFrame({ x: 3000, y: 200, width: 1000, height: 700 }, [screen]);
		expect(f).toEqual({ x: 460, y: 190, width: 1000, height: 700 });
	});

	test("shrinks to fit a smaller display", () => {
		const small = { x: 0, y: 0, width: 1280, height: 720 };
		const f = fitFrame({ x: 5000, y: 0, width: 1600, height: 1000 }, [small]);
		expect(f).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
	});

	test("accepts a frame on a secondary display", () => {
		const second = { x: 1920, y: 0, width: 2560, height: 1440 };
		const f = { x: 2200, y: 100, width: 1100, height: 720 };
		expect(fitFrame(f, [screen, second])).toEqual(f);
	});

	test("no display info trusts the saved frame", () => {
		const f = { x: -50, y: 10, width: 900, height: 600 };
		expect(fitFrame(f, [])).toEqual(f);
	});
});
