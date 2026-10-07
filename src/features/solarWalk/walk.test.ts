import { describe, expect, it } from "vitest"

import { bodyById, planets, sun } from "@/data"

import {
	NEAREST_STAR,
	SUN_OBJECTS,
	SUN_OBJECT_IDS,
	THINGS,
	buildWalk,
	landmarkOnWalk,
	landmarkCount,
	nearestThing,
	stopOf,
} from "./walk"
import { WALK_FOCUS_IDS } from "./search"

const basketball = buildWalk("basketball")
const stop = (id: string) => {
	const found = basketball.stops.find((s) => s.id === id)
	if (found === undefined) throw new Error(`no stop ${id}`)
	return found
}

describe("the basketball walk against known values", () => {
	it("makes the Sun the ball", () => {
		expect(basketball.sun.sizeM).toBeCloseTo(0.24, 10)
		expect(basketball.sun.distanceM).toBe(0)
	})

	it("puts the planets where published basketball models put them", () => {
		// The issue: Earth a 2 mm grain 26 m away, Mercury 10 m, Neptune 775 m
		expect(stop("earth").sizeM * 1000).toBeCloseTo(2.2, 1)
		expect(stop("earth").distanceM).toBeCloseTo(25.8, 1)
		expect(stop("mercury").distanceM).toBeCloseTo(10.0, 1)
		expect(stop("jupiter").sizeM * 1000).toBeCloseTo(24.1, 1)
		expect(stop("jupiter").distanceM).toBeCloseTo(134.3, 1)
		expect(stop("neptune").distanceM).toBeGreaterThan(772)
		expect(stop("neptune").distanceM).toBeLessThan(778)
		expect(basketball.lengthM).toBe(stop("neptune").distanceM)
	})

	it("keeps the textbook ratios: 1 AU is 107.5 Sun diameters, the Sun 109 Earths wide", () => {
		expect(stop("earth").distanceM / basketball.sun.sizeM).toBeCloseTo(107.5, 0)
		expect(basketball.sun.sizeM / stop("earth").sizeM).toBeCloseTo(109.2, 0)
	})

	it("puts the Moon 6.6 cm from Earth and the nearest star about 6,900 km away", () => {
		const moon = stop("earth").moons[0]
		expect(moon.id).toBe("moon")
		expect(moon.distanceM).toBeCloseTo(0.0663, 3)
		expect(moon.sizeM * 1000).toBeCloseTo(0.6, 1)
		expect(basketball.nearestStar.distanceM / 1000).toBeGreaterThan(6850)
		expect(basketball.nearestStar.distanceM / 1000).toBeLessThan(6950)
		expect(basketball.nearestStar.flightHours).toBeCloseTo(7.7, 1)
	})

	it("takes about 12 minutes to walk", () => {
		expect(basketball.walkingMinutes).toBeCloseTo(11.6, 1)
	})

	it("states the scale as 1 : 5.8 billion", () => {
		expect(basketball.scaleDenominator / 1e9).toBeCloseTo(5.8, 1)
	})
})

describe("one model: #21's true scale with the Sun as the ruler", () => {
	it("maps every true kilometre by the same factor, whatever the Sun is", () => {
		for (const id of SUN_OBJECT_IDS) {
			const walk = buildWalk(id)
			expect(walk.metresPerKm).toBeCloseTo(
				SUN_OBJECTS[id].diameterM / (2 * sun.radiusKm),
				15,
			)
			for (const s of walk.stops) {
				const body = bodyById.get(s.id)!
				expect(s.sizeM / walk.metresPerKm).toBeCloseTo(2 * body.radiusKm, 6)
				expect(s.distanceM / walk.metresPerKm).toBeCloseTo(
					body.orbit!.semiMajorAxisKm,
					3,
				)
				expect(s.trueDistanceKm).toBe(body.orbit!.semiMajorAxisKm)
				for (const m of s.moons) {
					const moon = bodyById.get(m.id)!
					expect(m.distanceM / walk.metresPerKm).toBeCloseTo(
						moon.orbit!.semiMajorAxisKm,
						3,
					)
				}
			}
			expect(walk.nearestStar.distanceM / walk.metresPerKm).toBeCloseTo(
				NEAREST_STAR.distanceKm,
				-3,
			)
		}
	})

	it("scales linearly with the object: a 1 m ball puts Earth 107.5 m away", () => {
		const big = buildWalk("exerciseBall")
		const earth = big.stops.find((s) => s.id === "earth")!
		expect(earth.distanceM).toBeCloseTo(107.5, 0)
		expect(earth.sizeM * 1000).toBeCloseTo(9.2, 1)
	})

	it("walks the planets in order, each leg from the previous one", () => {
		expect(basketball.stops.map((s) => s.id)).toEqual(planets.map((p) => p.id))
		let at = 0
		for (const s of basketball.stops) {
			expect(s.legM).toBeGreaterThan(0)
			at += s.legM
			expect(at).toBeCloseTo(s.distanceM, 9)
		}
	})

	it("lists the seven big moons (radius over 1000 km) under their planets", () => {
		const moons = Object.fromEntries(
			basketball.stops.map((s) => [s.id, s.moons.map((m) => m.id)]),
		)
		expect(moons).toEqual({
			mercury: [],
			venus: [],
			earth: ["moon"],
			mars: [],
			jupiter: ["io", "europa", "ganymede", "callisto"],
			saturn: ["titan"],
			uranus: [],
			neptune: ["triton"],
		})
	})
})

describe("opening the walk on a body (?focus=, #48)", () => {
	it("offers exactly the bodies the walk has a line for", () => {
		const lines = [
			"sun",
			...basketball.stops.flatMap((s) => [s.id, ...s.moons.map((m) => m.id)]),
		]
		expect([...WALK_FOCUS_IDS].sort()).toEqual(lines.sort())
	})

	it("finds a planet's stop, and a big moon on its planet's", () => {
		expect(stopOf(basketball, "jupiter")?.id).toBe("jupiter")
		expect(stopOf(basketball, "titan")?.id).toBe("saturn")
		expect(stopOf(basketball, "moon")?.id).toBe("earth")
		expect(stopOf(basketball, "sun")).toBeNull()
		expect(stopOf(basketball, "phobos")).toBeNull()
	})
})

describe("everyday comparisons", () => {
	it("names the classic things for the basketball model", () => {
		expect(stop("earth").thing).toBe("pinhead")
		expect(stop("venus").thing).toBe("pinhead")
		expect(stop("mercury").thing).toBe("poppySeed")
		expect(stop("jupiter").thing).toBe("cherry")
		expect(stop("neptune").thing).toBe("pea")
		expect(stop("uranus").thing).toBe("pea")
		expect(stop("earth").moons[0].thing).toBe("sugar")
		expect(basketball.nearestStar.thing).toBe("tableTennisBall")
	})

	it("is never off by more than 1.5x, for any Sun object", () => {
		for (const id of SUN_OBJECT_IDS) {
			const walk = buildWalk(id)
			const all = [
				...walk.stops,
				...walk.stops.flatMap((s) => s.moons),
				walk.nearestStar,
			]
			for (const body of all) {
				const ratio = body.sizeM / THINGS[body.thing].diameterM
				expect(Math.max(ratio, 1 / ratio), `${id}/${body.id}`).toBeLessThan(1.5)
			}
		}
	})

	it("picks the nearest thing on a log scale", () => {
		expect(nearestThing(0.008)).toBe("pea")
		expect(nearestThing(0.0021)).toBe("pinhead")
		expect(nearestThing(1e-6)).toBe("fineSand")
		expect(nearestThing(0.3)).toBe("football")
		expect(nearestThing(5)).toBe("house")
	})
})

describe("landmarks", () => {
	it("says where the first landmark length is reached", () => {
		// a pitch (105 m) ends between Mars (39 m) and Jupiter (134 m)
		const pitch = landmarkOnWalk(basketball, "pitch")!
		expect(pitch.before).toBe(4)
		expect(pitch.fromPreviousM + stop("mars").distanceM).toBeCloseTo(105, 9)
		expect(pitch.fromPreviousM + pitch.toNextM).toBeCloseTo(
			stop("jupiter").legM,
			9,
		)
		// a lap (400 m) between Saturn (247 m) and Uranus (495 m)
		expect(landmarkOnWalk(basketball, "track")?.before).toBe(6)
		// with a 1 m ball the pitch ends 2.5 m short of Earth (107.5 m)
		const big = landmarkOnWalk(buildWalk("exerciseBall"), "pitch")!
		expect(big.before).toBe(2)
		expect(big.toNextM).toBeCloseTo(2.5, 1)
		// an orange's walk ends at Neptune, 258 m: never a whole lap
		expect(landmarkOnWalk(buildWalk("orange"), "track")).toBeNull()
	})

	it("counts distances in landmark lengths", () => {
		expect(landmarkCount(775, "pitch")).toBeCloseTo(7.38, 2)
		expect(landmarkCount(800, "track")).toBe(2)
	})
})
