import { describe, expect, it } from "vitest"

import { AREA_SHARE, areaPlacement, spotKindFor, spotSeed } from "./spot"

describe("the Easy hints that show (#52)", () => {
	it("light up the area first, then the answer", () => {
		expect(spotKindFor(0)).toBeNull()
		expect(spotKindFor(1)).toBe("area")
		expect(spotKindFor(2)).toBe("pulse")
		expect(spotKindFor(3)).toBe("pulse")
	})

	it("seed the area's offset from the clue, the same every time", () => {
		expect(spotSeed("seeRed")).toBe(spotSeed("seeRed"))
		expect(spotSeed("seeRed")).not.toBe(spotSeed("seeHome"))
		expect(spotSeed("seeRed")).toBeGreaterThanOrEqual(0)
	})

	it("put the answer inside a part of the sky, never in its middle", () => {
		const ring = { x: 400, y: 300, discPx: 1, ringPx: 14 }
		for (const id of ["seeHome", "seeRed", "seeSun", "seeMoon", "x"]) {
			const area = areaPlacement(ring, spotSeed(id), 1280, 800)
			expect(area.ringPx).toBeCloseTo(AREA_SHARE * 800)
			const off = Math.hypot(area.x - ring.x, area.y - ring.y)
			expect(off, id).toBeGreaterThan(0.2 * area.ringPx)
			// the answer's whole ring inside the circle
			expect(off + ring.ringPx, id).toBeLessThan(area.ringPx)
		}
	})

	it("grow round a big disc so it still fits inside", () => {
		const ring = { x: 640, y: 400, discPx: 150, ringPx: 155 }
		const area = areaPlacement(ring, spotSeed("seeMoon"), 1280, 800)
		const off = Math.hypot(area.x - ring.x, area.y - ring.y)
		expect(off + ring.ringPx).toBeLessThan(area.ringPx)
	})
})
