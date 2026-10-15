import { describe, expect, it } from "vitest"

import { bodies, getBody, moonsOf, planets } from "@/data"
import {
	J2000_JD,
	SCALE_PRESETS,
	displayDistanceKm,
	propagate,
	radToDeg,
	spinAxis,
} from "@/sim"

import { CAMERA_FOV_DEG, FRAMING_RADII, fitDistance } from "../camera/framing"
import {
	SYSTEM_ELEVATION_DEG,
	SYSTEM_MARGIN,
	moonSystemDirection,
	moonSystemOf,
	moonSystemShot,
	moonSystemShotDistance,
	planetFramingRadii,
} from "./moonSystem"

describe("the curated moons (#17)", () => {
	it("features the moons with a story, curated by story and not by size", () => {
		const featured = (id: string) =>
			moonSystemOf(id).featured.map((moon) => moon.id)
		expect(featured("earth")).toEqual(["moon"])
		expect(featured("mars")).toEqual(["phobos", "deimos"])
		expect(featured("jupiter")).toEqual([
			"io",
			"europa",
			"ganymede",
			"callisto",
		])
		expect(featured("saturn")).toEqual([
			"mimas",
			"enceladus",
			"tethys",
			"dione",
			"rhea",
			"titan",
			"hyperion",
			"iapetus",
			"phoebe",
		])
		expect(featured("uranus")).toEqual([
			"miranda",
			"ariel",
			"umbriel",
			"titania",
			"oberon",
		])
		expect(featured("neptune")).toEqual(["proteus", "triton", "nereid"])
		// size is not the rule: tiny Deimos is featured, Amalthea (larger) is not
		expect(getBody("deimos").radiusKm).toBeLessThan(
			getBody("amalthea").radiusKm,
		)
		expect(getBody("amalthea").featured).toBeUndefined()
	})

	it("leaves the long tail for the viewer to ask for", () => {
		const all = bodies.filter((body) => body.kind === "moon")
		const featured = all.filter((moon) => moon.featured)
		// the 24 moons of the planets, plus Charon (#23)
		expect(featured).toHaveLength(25)
		expect(all.length - featured.length).toBeGreaterThan(150)
		expect(moonSystemOf("jupiter").others).toHaveLength(
			moonsOf("jupiter").length - 4,
		)
		expect(moonSystemOf("venus")).toEqual({ featured: [], others: [] })
	})

	it("features only moons", () => {
		expect(
			bodies.filter((body) => body.featured && body.kind !== "moon"),
		).toEqual([])
	})
})

describe("moonSystemShotDistance", () => {
	const scale = SCALE_PRESETS.everythingVisible
	const jupiter = getBody("jupiter")

	it("fits the outermost drawn orbit with a margin", () => {
		const { featured } = moonSystemOf("jupiter")
		const callisto = getBody("callisto").orbit!
		const radii = displayDistanceKm(
			callisto.semiMajorAxisKm * (1 + callisto.eccentricity),
			jupiter.radiusKm,
			1,
			scale.moonDistance,
		)
		expect(
			moonSystemShotDistance(jupiter, featured, scale, 16 / 9),
		).toBeCloseTo(
			fitDistance(SYSTEM_MARGIN * radii, CAMERA_FOV_DEG, 16 / 9) /
				FRAMING_RADII,
			9,
		)
	})

	it("steps back farther for the whole swarm and for true scale", () => {
		const { featured, others } = moonSystemOf("jupiter")
		const story = moonSystemShotDistance(jupiter, featured, scale, 1.5)
		const swarm = moonSystemShotDistance(
			jupiter,
			[...featured, ...others],
			scale,
			1.5,
		)
		expect(swarm).toBeGreaterThan(story)
		expect(
			moonSystemShotDistance(jupiter, featured, SCALE_PRESETS.trueScale, 1.5),
		).toBeGreaterThan(story)
		// a narrow phone screen needs more distance than a wide one (#61: the
		// shot is a multiple of the planet's framing, which backs off there too)
		expect(
			moonSystemShotDistance(jupiter, featured, scale, 0.5) *
				planetFramingRadii(jupiter, 0.5),
		).toBeGreaterThan(story * planetFramingRadii(jupiter, 1.5))
	})

	it("is never closer than the close-up, and 1 without moons", () => {
		for (const planet of planets) {
			const { featured } = moonSystemOf(planet.id)
			expect(
				moonSystemShotDistance(planet, featured, scale, 1.5),
			).toBeGreaterThanOrEqual(1)
		}
		expect(moonSystemShotDistance(getBody("venus"), [], scale, 1.5)).toBe(1)
	})
})

describe("moonSystemDirection", () => {
	it.each(["jupiter", "saturn", "uranus", "neptune", "earth"])(
		"looks down on %s's equator from the Sun's side",
		(id) => {
			const planet = getBody(id)
			const d = moonSystemDirection(planet, J2000_JD)
			expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 9)
			const pole = spinAxis(planet.rotation, planet.orbit)
			const dot = Math.abs(d.x * pole.x + d.y * pole.y + d.z * pole.z)
			// SYSTEM_ELEVATION_DEG above the equator plane, on the northern side
			expect(radToDeg(Math.asin(dot))).toBeCloseTo(SYSTEM_ELEVATION_DEG, 6)
			expect(d.y).toBeGreaterThan(-1e-9)
			const p = propagate(planet.orbit!, J2000_JD)
			expect(d.x * -p.x + d.y * -p.y + d.z * -p.z).toBeGreaterThan(0)
		},
	)

	it("turns into camera angles the director understands", () => {
		const saturn = getBody("saturn")
		const shot = moonSystemShot(
			saturn,
			moonSystemOf("saturn").featured,
			SCALE_PRESETS.everythingVisible,
			1.5,
			J2000_JD,
		)
		const d = moonSystemDirection(saturn, J2000_JD)
		const az = (shot.azimuthDeg * Math.PI) / 180
		const el = (shot.elevationDeg * Math.PI) / 180
		// camera-controls: theta about +Y from +Z, phi from +Y
		expect(Math.cos(el) * Math.sin(az)).toBeCloseTo(d.x, 9)
		expect(Math.sin(el)).toBeCloseTo(d.y, 9)
		expect(Math.cos(el) * Math.cos(az)).toBeCloseTo(d.z, 9)
		expect(shot.distance).toBeGreaterThan(1)
	})
})
