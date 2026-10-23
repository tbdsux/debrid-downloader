import { describe, expect, test } from "bun:test";
import { clipboardCandidate, nameFromUrl, parseMagnet, safeFileName, splitLines } from "./magnet";

const HASH = "c9e15763f722f23e98a29decdfae341b98d53056";

describe("magnet parsing", () => {
	test("full magnet with name", () => {
		const m = parseMagnet(
			`magnet:?xt=urn:btih:${HASH.toUpperCase()}&dn=Big+Buck+Bunny&tr=udp%3A%2F%2Fx`,
		);
		expect(m).toEqual({
			hash: HASH,
			name: "Big Buck Bunny",
			uri: `magnet:?xt=urn:btih:${HASH.toUpperCase()}&dn=Big+Buck+Bunny&tr=udp%3A%2F%2Fx`,
		});
	});

	test("bare info hash becomes a magnet", () => {
		expect(parseMagnet(HASH)?.uri).toBe(`magnet:?xt=urn:btih:${HASH}`);
	});

	test("base32 hash accepted, junk rejected", () => {
		expect(parseMagnet("magnet:?xt=urn:btih:MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43U")).not.toBeNull();
		expect(parseMagnet("magnet:?dn=nohash")).toBeNull();
		expect(parseMagnet("https://example.com")).toBeNull();
	});

	test("clipboard candidates", () => {
		expect(clipboardCandidate(`  ${HASH}  `)).toBe(HASH);
		expect(clipboardCandidate("https://host.example/f/Movie.mkv some text")).toBe(
			"https://host.example/f/Movie.mkv",
		);
		expect(clipboardCandidate("https://git.example/Libraries/debrid-ts")).toBeNull();
		expect(clipboardCandidate("just words")).toBeNull();
		expect(clipboardCandidate(null)).toBeNull();
	});

	test("helpers", () => {
		expect(splitLines("a\n\n b \r\na")).toEqual(["a", "b"]);
		expect(nameFromUrl("https://h.example/dl/My%20File.mkv?x=1")).toBe("My File.mkv");
		expect(safeFileName('a/b:c*?"<>|.mkv')).toBe("a_b_c______.mkv");
		expect(safeFileName("...")).toBe("download");
	});
});
