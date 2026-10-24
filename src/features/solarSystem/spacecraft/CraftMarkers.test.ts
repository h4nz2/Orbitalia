/**
 * Picking a spacecraft (#70, #73): its diamond within `CRAFT_PICK_RADIUS_PX`
 * before everything, its model only as far as the model's core reaches on
 * screen, and there where the craft really is, so a planet in front of it
 * takes the tap.
 */
import { Vector3 } from "three"
import { describe, expect, it } from "vitest"

import {
	CRAFT_PICK_RADIUS_PX,
	craftHitDistance,
	craftPickRadiusPx,
	pickCraftMarker,
} from "./CraftMarkers"

describe("craftPickRadiusPx", () => {
	it("is the diamond's radius without a model, and for a small one", () => {
		expect(craftPickRadiusPx(0, 0)).toBe(CRAFT_PICK_RADIUS_PX)
		expect(craftPickRadiusPx(20, 1)).toBe(CRAFT_PICK_RADIUS_PX)
		// a model's last size, faded out: the diamond's again
		expect(craftPickRadiusPx(200, 0)).toBe(CRAFT_PICK_RADIUS_PX)
	})

	it("widens to the model's core radius on screen, as far as it has faded in", () => {
		expect(craftPickRadiusPx(48, 1)).toBe(24)
		expect(craftPickRadiusPx(100, 1)).toBe(50)
		expect(craftPickRadiusPx(100, 0.5)).toBe(25)
	})
})

describe("craftHitDistance", () => {
	it("puts a hit on the diamond before everything, one farther out on the model where the craft is", () => {
		expect(craftHitDistance(0, 42)).toBe(0)
		expect(craftHitDistance(CRAFT_PICK_RADIUS_PX, 42)).toBe(0)
		expect(craftHitDistance(CRAFT_PICK_RADIUS_PX + 0.5, 42)).toBe(42)
	})
})

describe("pickCraftMarker", () => {
	// a camera at the origin looking down -z, 1000 px per radian
	const origin = new Vector3(0, 0, 0)
	const anglePerPx = 1 / 1000
	/** A ray `px` to the right of straight ahead. */
	const ray = (px: number) =>
		new Vector3(Math.tan(px * anglePerPx), 0, -1).normalize()
	// two crafts 10 units ahead: one straight ahead, one 100 px to the right
	const positions = new Float32Array([
		0,
		0,
		-10,
		10 * Math.tan(100 * anglePerPx),
		0,
		-10,
	])

	it("hits a craft within its radius, the nearest on screen first", () => {
		const radii = new Float32Array([12, 12])
		expect(
			pickCraftMarker(positions, 2, origin, ray(5), anglePerPx, radii),
		).toBe(0)
		expect(
			pickCraftMarker(positions, 2, origin, ray(95), anglePerPx, radii),
		).toBe(1)
		expect(
			pickCraftMarker(positions, 2, origin, ray(30), anglePerPx, radii),
		).toBe(-1)
	})

	it("reaches as far as a model's core, not beyond", () => {
		const radii = new Float32Array([craftPickRadiusPx(80, 1), 12])
		expect(
			pickCraftMarker(positions, 2, origin, ray(35), anglePerPx, radii),
		).toBe(0)
		expect(
			pickCraftMarker(positions, 2, origin, ray(45), anglePerPx, radii),
		).toBe(-1)
	})

	it("never hits a craft behind the camera", () => {
		const behind = new Float32Array([0, 0, 10])
		expect(
			pickCraftMarker(
				behind,
				1,
				origin,
				ray(0),
				anglePerPx,
				new Float32Array([12]),
			),
		).toBe(-1)
	})
})
