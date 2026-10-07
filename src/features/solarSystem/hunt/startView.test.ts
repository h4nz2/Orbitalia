import { describe, expect, it } from "vitest"

import { getBody } from "@/data"
import { SCALE_PRESETS } from "@/sim"

import { CAMERA_FOV_DEG, overviewDistance } from "../camera/framing"
import {
	BAR_ROOM_PX,
	EDGE_ROOM_PX,
	clearFitDistance,
	clearanceOf,
	drawnPosition,
	framedMoons,
	moonsShotDistance,
	overviewPx,
	overviewShotDistance,
} from "./startView"

const scale = SCALE_PRESETS.everythingVisible

describe("where an Easy clue is asked from (#52)", () => {
	it("keeps clear of a panel at the right, or of a sheet from the bottom", () => {
		const side = 640 - EDGE_ROOM_PX
		const bars = 400 - BAR_ROOM_PX
		expect(clearanceOf(1280, 800, null)).toEqual({
			width: 1280,
			height: 800,
			left: side,
			right: side,
			up: bars,
			down: bars,
		})
		// the dock beside the scene at x = 880: only the right side shrinks
		expect(clearanceOf(1280, 800, { left: 880, top: 380 })).toMatchObject({
			left: side,
			right: 880 - 640 - EDGE_ROOM_PX,
			up: bars,
			down: bars,
		})
		// a phone: the panel is a sheet over the lower part
		expect(clearanceOf(390, 844, { left: 8, top: 560 })).toMatchObject({
			left: 195 - EDGE_ROOM_PX,
			right: 195 - EDGE_ROOM_PX,
			down: 560 - 422 - EDGE_ROOM_PX,
		})
	})

	it("backs off further the less room there is", () => {
		const wide = clearanceOf(1280, 800, null)
		const narrow = clearanceOf(1280, 800, { left: 800, top: 300 })
		expect(clearFitDistance(1, narrow)).toBeGreaterThan(
			clearFitDistance(1, wide),
		)
		expect(clearFitDistance(2, wide)).toBeCloseTo(2 * clearFitDistance(1, wide))
	})

	it("places a planet in the overview where the scene draws it", () => {
		// 7 Oct 2026, 13:00 UTC at 1280 x 800: Neptune measured at (917, 395)
		const jd = 2461321.04
		const base = overviewDistance(scale, CAMERA_FOV_DEG, 1280 / 800)
		const at = overviewPx(
			drawnPosition(getBody("neptune"), scale, jd),
			base,
			800,
		)
		expect(at.x).toBeCloseTo(917 - 640, -1)
		expect(at.y).toBeCloseTo(395 - 400, -1)
		expect(drawnPosition(getBody("sun"), scale, jd)).toEqual({
			x: 0,
			y: 0,
			z: 0,
		})
	})

	it("leaves the overview alone unless a panel would cover the answer or its name", () => {
		const jd = 2461321.04
		const beside = clearanceOf(1280, 800, { left: 880, top: 380 })
		const where = (id: string) => [drawnPosition(getBody(id), scale, jd)]
		const label = { width: 110, height: 24 }
		expect(overviewShotDistance(where("sun"), scale, beside, label)).toBe(1)
		expect(overviewShotDistance(where("earth"), scale, beside, label)).toBe(1)
		// Neptune and its name would sit under a panel at the right: back off
		const neptune = overviewShotDistance(where("neptune"), scale, beside, label)
		expect(neptune).toBeGreaterThan(1)
		const at = overviewPx(
			where("neptune")[0],
			neptune * overviewDistance(scale, CAMERA_FOV_DEG, 1280 / 800),
			800,
		)
		expect(at.x + label.width).toBeLessThanOrEqual(beside.right + 1)
		// with no panel the whole system already fits
		expect(
			overviewShotDistance(
				where("neptune"),
				scale,
				clearanceOf(1280, 800, null),
				label,
			),
		).toBe(1)
	})

	it("frames a moon with the moons out to the next one, as company", () => {
		const ids = (planet: string, answer: string) =>
			framedMoons(getBody(planet), [answer]).map((moon) => moon.id)
		expect(ids("earth", "moon")).toEqual(["moon"])
		expect(ids("jupiter", "io")).toEqual(["io", "europa"])
		expect(ids("saturn", "titan")).toEqual([
			"mimas",
			"enceladus",
			"tethys",
			"dione",
			"rhea",
			"titan",
			"hyperion",
		])
	})

	it("backs off from a moon system until it is clear of the panel", () => {
		const saturn = getBody("saturn")
		const moons = framedMoons(saturn, ["titan"])
		const free = moonsShotDistance(
			saturn,
			moons,
			scale,
			clearanceOf(1280, 800, null),
		)
		const beside = moonsShotDistance(
			saturn,
			moons,
			scale,
			clearanceOf(1280, 800, { left: 880, top: 380 }),
		)
		expect(free).toBeGreaterThanOrEqual(1)
		expect(beside).toBeGreaterThan(free)
	})
})
