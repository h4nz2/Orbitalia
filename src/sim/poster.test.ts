/**
 * Poster (#54), the most distorted preset, guarded as a product choice: the
 * classroom poster's rules (sizes and distances in true order, nothing
 * touching), its moon rule, the anchored distance curve it is built on and
 * the numbers its texts state. What it looks like on a 1366x768 screen is
 * src/features/solarSystem/camera/poster.test.ts.
 */
import { describe, expect, it } from "vitest"

import { bodies, getBody, planets, sun, type Body } from "@/data"

import { buildIndex, computePositions } from "./positions"
import {
	HIDES_LONG_TAIL,
	SCALE_PRESETS,
	SCALE_PRESET_IDS,
	anchoredDistance,
	childDistanceCurve,
	computeDisplayPositions,
	computeDisplayRadii,
	displayDistanceKm,
	displayRadiusKm,
	interpolateScale,
	isValidScale,
	mapDistance,
	moonSizeOf,
	presetOf,
	sameScale,
	unmapDistance,
	type ScaleSettings,
} from "./scale"
import {
	SCALE_LIES,
	bodyDistortion,
	isGridPreset,
	presetForLies,
} from "./scaleLies"
import { J2000_JD } from "./time"

const POSTER = SCALE_PRESETS.poster
const EV = SCALE_PRESETS.everythingVisible
const index = buildIndex(bodies)
const radii = computeDisplayRadii(bodies, POSTER)

/** Drawn radius (display km) of a body under Poster, the engine's own (moons against their planet). */
const drawnRadius = (body: Body): number => radii[index.get(body.id) ?? -1]
const parentOf = (body: Body): Body => getBody(body.parentId ?? "")
/** Drawn distance (display km) from the parent of a body at `km` (true) from it. */
const drawnDistance = (body: Body, km: number): number => {
	const parent = parentOf(body)
	return displayDistanceKm(
		km,
		parent.radiusKm,
		drawnRadius(parent),
		childDistanceCurve(POSTER, parent.parentId === null),
	)
}
const peri = (body: Body) =>
	(body.orbit?.semiMajorAxisKm ?? 0) * (1 - (body.orbit?.eccentricity ?? 0))
const apo = (body: Body) =>
	(body.orbit?.semiMajorAxisKm ?? 0) * (1 + (body.orbit?.eccentricity ?? 0))
const earth = getBody("earth")
const featuredMoonsOf = (planet: Body) =>
	bodies.filter((b) => b.parentId === planet.id && b.featured === true)
/** How far out a planet's featured moons reach from its centre, drawn. */
const moonExtent = (planet: Body): number =>
	Math.max(
		0,
		...featuredMoonsOf(planet).map(
			(moon) => drawnDistance(moon, apo(moon)) + drawnRadius(moon),
		),
	)

describe("Poster: the planets (#54)", () => {
	it("draws a bigger planet bigger, and the Sun bigger than every planet", () => {
		const bySize = [...planets].sort((a, b) => a.radiusKm - b.radiusKm)
		for (let k = 1; k < bySize.length; k++) {
			expect(drawnRadius(bySize[k])).toBeGreaterThan(drawnRadius(bySize[k - 1]))
		}
		expect(drawnRadius(sun)).toBe(sun.radiusKm)
		expect(drawnRadius(sun)).toBeGreaterThan(
			1.5 * drawnRadius(getBody("jupiter")),
		)
	})

	it("keeps Jupiter and Saturn clearly the biggest, Saturn's rings the widest", () => {
		const jupiter = getBody("jupiter")
		const saturn = getBody("saturn")
		const uranus = getBody("uranus")
		expect(drawnRadius(jupiter)).toBeGreaterThan(1.8 * drawnRadius(earth))
		expect(drawnRadius(saturn)).toBeGreaterThan(1.7 * drawnRadius(earth))
		expect(drawnRadius(saturn)).toBeGreaterThan(1.25 * drawnRadius(uranus))
		// the rings scale with the planet (displayBodyLengthKm): more than twice Jupiter across
		const rings = (saturn.rings?.outerRadiusKm ?? 0) / saturn.radiusKm
		expect(rings * drawnRadius(saturn)).toBeGreaterThan(
			2 * drawnRadius(jupiter),
		)
	})

	it("draws an orbit farther out farther out", () => {
		for (let k = 1; k < planets.length; k++) {
			const a = (body: Body) =>
				drawnDistance(body, body.orbit?.semiMajorAxisKm ?? 0)
			expect(a(planets[k])).toBeGreaterThan(a(planets[k - 1]))
		}
	})

	it("keeps the Sun inside Mercury's orbit and every planet a drawn Earth radius clear of the Sun and of its neighbours' paths", () => {
		const clearance = drawnRadius(earth)
		let previousOuter = drawnRadius(sun)
		for (const planet of planets) {
			const inner = drawnDistance(planet, peri(planet)) - drawnRadius(planet)
			expect(inner - previousOuter, planet.id).toBeGreaterThan(clearance)
			previousOuter = drawnDistance(planet, apo(planet)) + drawnRadius(planet)
		}
	})
})

describe("Poster: the moons", () => {
	it("draws every moon true to its planet's drawn size", () => {
		expect(moonSizeOf(POSTER).exponent).toBe(1)
		for (const moon of bodies.filter((b) => b.kind === "moon")) {
			const parent = parentOf(moon)
			expect(drawnRadius(moon) / drawnRadius(parent)).toBeCloseTo(
				moon.radiusKm / parent.radiusKm,
				12,
			)
		}
	})

	it("keeps every featured moon system clear of the neighbouring planets' orbits, with 5 % to spare", () => {
		// the full gap, not half of it: only the focus family's moon orbits are drawn (and the long tail is hidden)
		planets.forEach((planet, i) => {
			const extent = moonExtent(planet)
			if (extent === 0) return
			if (i > 0) {
				const inner = planets[i - 1]
				expect(
					drawnDistance(planet, peri(planet)) -
						drawnDistance(inner, apo(inner)),
					`${planet.id} toward ${inner.id}`,
				).toBeGreaterThan(1.05 * extent)
			}
			if (i < planets.length - 1) {
				const outer = planets[i + 1]
				expect(
					drawnDistance(outer, peri(outer)) -
						drawnDistance(planet, apo(planet)),
					`${planet.id} toward ${outer.id}`,
				).toBeGreaterThan(1.05 * extent)
			}
		})
	})

	it("never lets two major moons (radius >= 150 km) touch", () => {
		for (const planet of planets) {
			const major = bodies
				.filter((b) => b.parentId === planet.id && b.radiusKm >= 150)
				.sort(
					(a, b) =>
						(a.orbit?.semiMajorAxisKm ?? 0) - (b.orbit?.semiMajorAxisKm ?? 0),
				)
			for (let k = 1; k < major.length; k++) {
				const gap =
					drawnDistance(major[k], peri(major[k])) -
					drawnDistance(major[k - 1], apo(major[k - 1]))
				expect(gap, major[k].id).toBeGreaterThan(
					1.2 * (drawnRadius(major[k]) + drawnRadius(major[k - 1])),
				)
			}
		}
	})

	it("keeps the featured moons outside their planet's rings and squeezed close", () => {
		for (const planet of planets) {
			const moons = featuredMoonsOf(planet)
			if (moons.length === 0) continue
			const ring =
				((planet.rings?.outerRadiusKm ?? planet.radiusKm) / planet.radiusKm) *
				drawnRadius(planet)
			for (const moon of moons) {
				expect(
					drawnDistance(moon, peri(moon)) - drawnRadius(moon),
					moon.id,
				).toBeGreaterThan(1.05 * ring)
			}
			// gathered within five drawn radii of the planet
			expect(moonExtent(planet) / drawnRadius(planet)).toBeLessThan(5)
		}
	})

	it("hides the long tail of moons, which has no room between the planets", () => {
		expect([...HIDES_LONG_TAIL]).toEqual(["poster"])
	})
})

describe("Poster's honest numbers (the texts: sizes 5 to 60x, distances 50 to 500x)", () => {
	const oneDigit = (x: number) => {
		const p = 10 ** Math.floor(Math.log10(x))
		return Math.round(x / p) * p
	}
	const distortions = planets.map((planet) =>
		bodyDistortion(planet, sun, sun.radiusKm, POSTER),
	)

	it("draws the planets 5 to 60 times too big", () => {
		const sizes = distortions.map((d) => d.size)
		expect(oneDigit(Math.min(...sizes))).toBe(5)
		expect(oneDigit(Math.max(...sizes))).toBe(60)
		// Earth, the statement's default subject: about 29x
		expect(bodyDistortion(earth, sun, sun.radiusKm, POSTER).size).toBeCloseTo(
			29.3,
			0,
		)
	})

	it("draws them 50 to 500 times too close to the Sun", () => {
		const closer = distortions.map((d) => 1 / d.distance)
		expect(oneDigit(Math.min(...closer))).toBe(50)
		expect(oneDigit(Math.max(...closer))).toBe(500)
	})

	it("measures a moon against its planet: true to it in size", () => {
		const moon = bodyDistortion(getBody("moon"), earth, sun.radiusKm, POSTER)
		expect(moon.size).toBeCloseTo(
			bodyDistortion(earth, sun, sun.radiusKm, POSTER).size,
			9,
		)
	})
})

describe("Poster beside the sizes x distances grid", () => {
	it("tells Everything visible's lies but is not their cell", () => {
		expect(SCALE_LIES.poster).toEqual(SCALE_LIES.everythingVisible)
		expect(isGridPreset("poster")).toBe(false)
		expect(SCALE_PRESET_IDS.filter(isGridPreset)).toEqual([
			"trueScale",
			"textbook",
			"bigPlanets",
			"everythingVisible",
		])
		for (const sizes of ["true", "enlarged"] as const) {
			for (const distances of ["true", "squeezed"] as const) {
				expect(presetForLies({ sizes, distances })).not.toBe("poster")
			}
		}
	})
})

describe("the anchored distance curve", () => {
	const curve = POSTER.orbitDistance

	it("passes through the knee and every anchor", () => {
		expect(mapDistance(curve, 1)).toBe(1)
		expect(mapDistance(curve, 0.5)).toBe(0.5)
		for (const [x, y] of curve.anchors) {
			expect(mapDistance(curve, x)).toBeCloseTo(y, 12)
			expect(anchoredDistance(curve.knee, curve.anchors, x)).toBeCloseTo(y, 12)
		}
	})

	it("is continuous and monotone from the Sun's surface to far beyond Neptune, never inside the Sun", () => {
		expect(mapDistance(curve, 1 + 1e-9)).toBeCloseTo(1, 6)
		let previous = 1
		for (let x = 1.001; x < 1e6; x *= 1.01) {
			const y = mapDistance(curve, x)
			expect(y).toBeGreaterThan(previous)
			expect(y).toBeGreaterThanOrEqual(Math.min(x, curve.knee))
			previous = y
		}
		// past the last anchor: a straight line in the log, at the last slope
		const [xn, yn] = curve.anchors[curve.anchors.length - 1]
		const slope = mapDistance(curve, xn * Math.E) - yn
		expect(mapDistance(curve, xn * Math.E ** 2) - yn).toBeCloseTo(2 * slope, 9)
	})

	it("keeps the dwarf planets past Neptune, in order, and moves no planet off its true direction", () => {
		const truePositions = computePositions(bodies, J2000_JD, undefined, index)
		const display = computeDisplayPositions(
			bodies,
			truePositions,
			radii,
			POSTER,
			index,
		)
		const dist = (id: string) => {
			const i = (index.get(id) ?? -1) * 3
			return Math.hypot(display[i], display[i + 1], display[i + 2])
		}
		const neptune = drawnDistance(getBody("neptune"), apo(getBody("neptune")))
		for (const id of ["pluto", "haumea", "makemake", "eris"]) {
			expect(dist(id), id).toBeGreaterThan(
				drawnDistance(getBody(id), peri(getBody(id))) * 0.999,
			)
			expect(drawnDistance(getBody(id), apo(getBody(id)))).toBeGreaterThan(
				neptune,
			)
		}
		expect(
			drawnDistance(
				getBody("eris"),
				getBody("eris").orbit?.semiMajorAxisKm ?? 0,
			),
		).toBeGreaterThan(
			drawnDistance(
				getBody("pluto"),
				getBody("pluto").orbit?.semiMajorAxisKm ?? 0,
			),
		)
	})

	it("round-trips through its numeric inverse", () => {
		for (const x of [1.5, 50, 83.3, 200, 1119, 6468, 2e4, 1e6]) {
			const back = unmapDistance(curve, mapDistance(curve, x))
			expect(Math.abs(back - x)).toBeLessThanOrEqual(1e-9 * x)
		}
	})

	it("blends geometrically to and from every other preset: valid and monotone at every step", () => {
		for (const id of SCALE_PRESET_IDS) {
			if (id === "poster") continue
			for (const [from, to] of [
				[SCALE_PRESETS[id], POSTER],
				[POSTER, SCALE_PRESETS[id]],
			] as [ScaleSettings, ScaleSettings][]) {
				expect(interpolateScale(from, to, 0)).toBe(from)
				expect(interpolateScale(from, to, 1)).toBe(to)
				for (let t = 0.1; t < 0.95; t += 0.1) {
					const mid = interpolateScale(from, to, t)
					expect(isValidScale(mid)).toBe(true)
					expect(presetOf(mid)).toBeNull()
					let previous = 0
					for (let x = 0.5; x < 1e5; x *= 1.2) {
						const y = mapDistance(mid.orbitDistance, x)
						expect(y).toBeGreaterThan(previous)
						previous = y
					}
				}
			}
		}
		// Neptune moves in steadily from Everything visible to Poster
		const n = (getBody("neptune").orbit?.semiMajorAxisKm ?? 0) / sun.radiusKm
		let previous = Infinity
		for (let t = 0; t <= 1.0001; t += 0.1) {
			const d = mapDistance(interpolateScale(EV, POSTER, t).orbitDistance, n)
			expect(d).toBeLessThan(previous)
			previous = d
		}
	})

	it("rejects anchors that would break the model", () => {
		const anchored = (anchors: readonly (readonly [number, number])[]) => ({
			...POSTER,
			orbitDistance: { ...POSTER.orbitDistance, anchors },
		})
		expect(isValidScale(POSTER)).toBe(true)
		expect(isValidScale(anchored([[10, 2]]))).toBe(true)
		// inside the knee, descending, or a share outside 0..1
		expect(isValidScale(anchored([[0.5, 2]]))).toBe(false)
		expect(isValidScale(anchored([[10, 0.5]]))).toBe(false)
		expect(
			isValidScale(
				anchored([
					[10, 3],
					[20, 2],
				]),
			),
		).toBe(false)
		expect(
			isValidScale(
				anchored([
					[10, 3],
					[5, 4],
				]),
			),
		).toBe(false)
		expect(isValidScale(anchored([[10, Number.NaN]]))).toBe(false)
		expect(
			isValidScale({
				...POSTER,
				orbitDistance: { ...POSTER.orbitDistance, anchorWeight: 1.5 },
			}),
		).toBe(false)
		expect(isValidScale({ ...POSTER, moonSize: { exponent: 0 } })).toBe(false)
		expect(isValidScale({ ...POSTER, overviewFit: -1 })).toBe(false)
	})
})

describe("moonSize: moons sized against their planet", () => {
	it("follows bodySize when absent, exactly as before: every other preset is unchanged", () => {
		for (const id of SCALE_PRESET_IDS) {
			const scale: ScaleSettings = SCALE_PRESETS[id]
			if (id === "poster") continue
			expect(scale.moonSize).toBeUndefined()
			const drawn = computeDisplayRadii(bodies, scale)
			bodies.forEach((body, i) => {
				expect(drawn[i]).toBe(
					displayRadiusKm(body.radiusKm, sun.radiusKm, scale.bodySize),
				)
			})
		}
		// stating it explicitly is the same scale
		expect(sameScale({ ...EV, moonSize: { exponent: 0.5 } }, EV)).toBe(true)
		expect(presetOf({ ...EV, moonSize: { exponent: 0.5 } })).toBe(
			"everythingVisible",
		)
		expect(presetOf({ ...EV, moonSize: { exponent: 1 } })).toBeNull()
	})

	it("blends from the planets' exponent to Poster's", () => {
		expect(interpolateScale(EV, POSTER, 0.5).moonSize?.exponent).toBeCloseTo(
			0.75,
			12,
		)
		expect(
			interpolateScale(EV, SCALE_PRESETS.textbook, 0.5).moonSize,
		).toBeUndefined()
	})

	it("needs every moon after its planet", () => {
		const moon = getBody("moon")
		expect(() => computeDisplayRadii([sun, moon, earth], POSTER)).toThrow(
			/comes after it/,
		)
	})
})
