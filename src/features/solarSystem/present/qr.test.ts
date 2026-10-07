import { describe, expect, it } from "vitest"
import { encode } from "uqr"

import { QR_OPTIONS, qrCode, qrPath } from "./qr"

/** The dark modules a path covers, by replaying its rectangles. */
const covered = (path: string): Set<string> => {
	const cells = new Set<string>()
	for (const [, x, y, w] of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
		for (let i = 0; i < Number(w); i += 1) {
			cells.add(`${Number(x) + i},${y}`)
		}
	}
	return cells
}

describe("qrPath", () => {
	it("draws each horizontal run of dark modules as one rectangle", () => {
		expect(
			qrPath([
				[true, true, false, true],
				[false, false, false, false],
				[false, true, true, true],
			]),
		).toBe("M0 0h2v1h-2zM3 0h1v1h-1zM1 2h3v1h-3z")
		expect(qrPath([[false, false]])).toBe("")
	})
})

describe("qrCode", () => {
	it("covers exactly the encoder's dark modules, quiet zone included", () => {
		const link =
			"https://example.org/solar_system?focus=earth&frame=earth&sel=mars&cam=0_89.9_120&t=2460691.5&warp=2629800&paused=true&present=true&lang=de&reading=simple"
		const code = qrCode(link)
		const { data, size } = encode(link, QR_OPTIONS)
		expect(code.size).toBe(size)
		const dark = new Set<string>()
		data.forEach((row, y) =>
			row.forEach((on, x) => {
				if (on) dark.add(`${x},${y}`)
			}),
		)
		expect(covered(code.path)).toEqual(dark)
		// the four-module quiet zone is light
		for (let i = 0; i < size; i += 1) {
			expect(dark.has(`${i},0`)).toBe(false)
			expect(dark.has(`0,${i}`)).toBe(false)
		}
	})

	it("keeps a classroom link's code coarse: low error correction (#50)", () => {
		// modules per side without the quiet zone: 17 + 4 x version
		const modules = (search: string) =>
			qrCode(`https://orbitalia.app/solar_system?${search}`).size - 8
		// the issue's view (88 characters): version 5, where M needed 6
		expect(
			modules("focus=jupiter&t=2461321.0417&lang=en&reading=standard"),
		).toBe(37)
		// a moved camera in projector mode (121): version 6, where M needed 7
		expect(
			modules(
				"focus=jupiter&cam=-40.3_15.2_2.35&t=2461321.0417&present=true&lang=en&reading=standard",
			),
		).toBe(41)
		// a prepared lesson (157): version 8, where M needed 9
		expect(
			modules(
				"focus=earth&frame=earth&sel=mars&cam=0_89.9_120&t=2460691.5&warp=2629800&paused=true&present=true&lang=de&reading=standard",
			),
		).toBe(49)
	})
})
