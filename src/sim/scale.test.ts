import { describe, expect, it } from "vitest"

import { bodies, getBody, planets, sun, type Body } from "@/data"
import { BodiesFile } from "@/data/schema"

import { buildIndex, computePositions } from "./positions"
import {
	DEFAULT_SCALE_PRESET,
	SCALE_PRESETS,
	SCALE_PRESET_IDS,
	TRUE_SCALE,
	childDistanceCurve,
	computeDisplayPositions,
	computeDisplayRadii,
	displayBodyLengthKm,
	displayDistanceKm,
	displayOffset,
	displayRadiusKm,
	distanceFactor,
	interpolateScale,
	isScalePresetId,
	isTrueScale,
	isValidScale,
	mapDistance,
	presetOf,
	rootIndexOf,
	sameScale,
	sizeExaggeration,
	type DistanceCurve,
	type ScaleSettings,
} from "./scale"
import { J2000_JD } from "./time"

const EV = SCALE_PRESETS.everythingVisible
const presets = SCALE_PRESET_IDS.map((id) => [id, SCALE_PRESETS[id]] as const)

/** Display positions and radii of the real data at `jd` under `scale`. */
const layout = (
	scale: ScaleSettings,
	list: readonly Body[] = bodies,
	jd = J2000_JD,
) => {
	const index = buildIndex(list)
	const truePositions = computePositions(list, jd, undefined, index)
	const radii = computeDisplayRadii(list, scale)
	const display = computeDisplayPositions(
		list,
		truePositions,
		radii,
		scale,
		index,
	)
	return { index, truePositions, radii, display }
}

const vec = (a: Float64Array, i: number) => [
	a[i * 3],
	a[i * 3 + 1],
	a[i * 3 + 2],
]
const sub = (a: number[], b: number[]) => a.map((v, k) => v - b[k])
const norm = (a: number[]) => Math.hypot(a[0], a[1], a[2])
const parentOf = (body: Body): Body => getBody(body.parentId ?? "")

describe("mapDistance", () => {
	const curve: DistanceCurve = { knee: 3, exponent: 0.2, gain: 2 }

	it("is the identity for an identity curve and below the knee", () => {
		for (const x of [0, 0.5, 1, 2.9, 3, 60, 2000]) {
			expect(mapDistance(TRUE_SCALE.moonDistance, x)).toBe(x)
			expect(mapDistance(TRUE_SCALE.orbitDistance, x)).toBe(x)
		}
		for (const x of [0, 1, 2, 3]) expect(mapDistance(curve, x)).toBe(x)
	})

	it("is continuous at the knee, monotone, and never below min(x, knee)", () => {
		expect(mapDistance(curve, 3 + 1e-9)).toBeCloseTo(3, 6)
		let previous = 0
		for (let x = 0.01; x < 5000; x *= 1.07) {
			const y = mapDistance(curve, x)
			expect(y).toBeGreaterThan(previous)
			expect(y).toBeGreaterThanOrEqual(Math.min(x, curve.knee))
			previous = y
		}
	})

	it("follows knee * (1 + gain * ((x / knee) ** exponent - 1)) beyond the knee", () => {
		expect(mapDistance(curve, 60)).toBeCloseTo(
			3 * (1 + 2 * (20 ** 0.2 - 1)),
			12,
		)
		expect(distanceFactor(curve, 60)).toBeCloseTo(
			mapDistance(curve, 60) / 60,
			12,
		)
		expect(distanceFactor(curve, 0)).toBe(1)
	})
})

describe("sizes", () => {
	it("keeps the root at its true size in every preset: the Sun is the ruler", () => {
		for (const [, scale] of presets) {
			expect(displayRadiusKm(sun.radiusKm, sun.radiusKm, scale.bodySize)).toBe(
				sun.radiusKm,
			)
		}
	})

	it("is exact at true scale and square-roots size ratios in Everything visible", () => {
		const earth = getBody("earth")
		expect(
			displayRadiusKm(earth.radiusKm, sun.radiusKm, TRUE_SCALE.bodySize),
		).toBe(earth.radiusKm)
		const drawn = displayRadiusKm(earth.radiusKm, sun.radiusKm, EV.bodySize)
		// the Sun is 109 Earths wide in reality, about 10.4 in Everything visible
		expect(sun.radiusKm / drawn).toBeCloseTo(
			Math.sqrt(sun.radiusKm / earth.radiusKm),
			9,
		)
		expect(
			sizeExaggeration(earth.radiusKm, sun.radiusKm, EV.bodySize),
		).toBeCloseTo(10.4, 1)
	})

	it("fills one radius per body, the root found as the body without a parent", () => {
		const radii = computeDisplayRadii(bodies, EV)
		expect(radii.length).toBe(bodies.length)
		expect(rootIndexOf(bodies)).toBe(0)
		expect(radii[0]).toBe(sun.radiusKm)
		const reused = new Float64Array(bodies.length)
		expect(computeDisplayRadii(bodies, EV, reused)).toBe(reused)
		expect(() =>
			rootIndexOf([{ id: "x", parentId: "y", orbit: null, radiusKm: 1 }]),
		).toThrow(/root/)
	})
})

describe("displayOffset", () => {
	it("keeps the direction and rescales the length to the parent's drawn radii", () => {
		const out = new Float64Array(6)
		const curve = EV.moonDistance
		displayOffset(3e5, -4e5, 1.2e5, 6371, 66_000, curve, out, 3)
		const length = Math.hypot(out[3], out[4], out[5])
		const trueLength = Math.hypot(3e5, -4e5, 1.2e5)
		expect(length).toBeCloseTo(
			displayDistanceKm(trueLength, 6371, 66_000, curve),
			6,
		)
		// same direction: the cross product vanishes
		expect(out[3] / 3e5).toBeCloseTo(out[4] / -4e5, 12)
		expect(out[4] / -4e5).toBeCloseTo(out[5] / 1.2e5, 12)
		expect(Array.from(out.slice(0, 3))).toEqual([0, 0, 0])
		displayOffset(0, 0, 0, 6371, 66_000, curve, out)
		expect(Array.from(out.slice(0, 3))).toEqual([0, 0, 0])
	})

	it("uses orbitDistance around the root and moonDistance around anything else", () => {
		expect(childDistanceCurve(EV, true)).toBe(EV.orbitDistance)
		expect(childDistanceCurve(EV, false)).toBe(EV.moonDistance)
	})
})

describe("computeDisplayPositions", () => {
	it("is the true layout at true scale", () => {
		const { truePositions, display } = layout(TRUE_SCALE)
		for (let k = 0; k < display.length; k++) {
			expect(Math.abs(display[k] - truePositions[k])).toBeLessThanOrEqual(
				1e-12 * Math.max(1, Math.abs(truePositions[k])),
			)
		}
	})

	it("keeps every parent -> child direction true and every child outside its parent, in every preset", () => {
		for (const [, scale] of presets) {
			const { index, truePositions, radii, display } = layout(
				scale,
				bodies,
				J2000_JD + 777.7,
			)
			for (const body of bodies) {
				if (body.parentId === null) continue
				const i = index.get(body.id) ?? -1
				const p = index.get(body.parentId) ?? -1
				const trueOffset = sub(vec(truePositions, i), vec(truePositions, p))
				const drawnOffset = sub(vec(display, i), vec(display, p))
				const t = norm(trueOffset)
				const d = norm(drawnOffset)
				for (let k = 0; k < 3; k++) {
					expect(drawnOffset[k] / d).toBeCloseTo(trueOffset[k] / t, 9)
				}
				// never inside (or touching) the drawn parent
				expect(d - radii[i]).toBeGreaterThan(radii[p])
			}
		}
	})

	it("places children through the same curve their orbit lines use", () => {
		const { index, truePositions, radii, display } = layout(EV)
		const io = index.get("io") ?? -1
		const jupiter = index.get("jupiter") ?? -1
		const drawn = norm(sub(vec(display, io), vec(display, jupiter)))
		const trueDistance = norm(
			sub(vec(truePositions, io), vec(truePositions, jupiter)),
		)
		expect(drawn).toBeCloseTo(
			displayDistanceKm(
				trueDistance,
				getBody("jupiter").radiusKm,
				radii[jupiter],
				EV.moonDistance,
			),
			6,
		)
	})

	it("reuses the output array and rejects non-topological input", () => {
		const { index, truePositions, radii } = layout(EV)
		const out = new Float64Array(bodies.length * 3)
		expect(
			computeDisplayPositions(bodies, truePositions, radii, EV, index, out),
		).toBe(out)
		const reversed = [...bodies].reverse()
		expect(() =>
			computeDisplayPositions(
				reversed,
				truePositions,
				radii,
				EV,
				buildIndex(reversed),
			),
		).toThrow(/comes after it/)
	})
})

describe("a new body is added by data alone", () => {
	// a dwarf planet on Pluto's real orbit and a moon of it: no code change, only data
	const pluto: Body = {
		...getBody("neptune"),
		id: "testpluto",
		name: "Test Pluto",
		kind: "planet",
		parentId: "sun",
		radiusKm: 1188.3,
		massKg: 1.303e22,
		orbit: {
			semiMajorAxisKm: 5_906_376_272,
			eccentricity: 0.2488,
			inclinationDeg: 17.16,
			longAscNodeDeg: 110.3,
			argPeriapsisDeg: 113.8,
			meanAnomalyDeg: 14.53,
			periodDays: 90_560,
			epochJD: J2000_JD,
		},
		rings: null,
		info: {},
	}
	const charon: Body = {
		...getBody("moon"),
		id: "testcharon",
		name: "Test Charon",
		parentId: "testpluto",
		radiusKm: 606,
		orbit: {
			semiMajorAxisKm: 19_596,
			eccentricity: 0.0002,
			inclinationDeg: 112.9,
			longAscNodeDeg: 223,
			argPeriapsisDeg: 0,
			meanAnomalyDeg: 0,
			periodDays: 6.387,
			epochJD: J2000_JD,
		},
		info: {},
	}
	const extended = [...bodies, pluto, charon]

	it("validates against the data schema", () => {
		expect(BodiesFile.safeParse(extended).success).toBe(true)
	})

	it("is sized and placed by the same rules as everything else", () => {
		const { index, truePositions, radii, display } = layout(EV, extended)
		const p = index.get("testpluto") ?? -1
		const c = index.get("testcharon") ?? -1
		expect(radii[p]).toBe(
			displayRadiusKm(pluto.radiusKm, sun.radiusKm, EV.bodySize),
		)
		// orbits the root: the orbit curve, measured in solar radii
		expect(norm(vec(display, p))).toBeCloseTo(
			displayDistanceKm(
				norm(vec(truePositions, p)),
				sun.radiusKm,
				sun.radiusKm,
				EV.orbitDistance,
			),
			3,
		)
		// orbits a non-root body: the moon curve, measured in the dwarf planet's radii
		const trueOffset = norm(sub(vec(truePositions, c), vec(truePositions, p)))
		expect(norm(sub(vec(display, c), vec(display, p)))).toBeCloseTo(
			displayDistanceKm(trueOffset, pluto.radiusKm, radii[p], EV.moonDistance),
			3,
		)
		// and past Neptune, as in reality
		const neptune = index.get("neptune") ?? -1
		expect(norm(vec(display, p))).toBeGreaterThan(
			norm(vec(display, neptune)) * 0.9,
		)
	})
})

describe("Everything visible, the default (a product choice guarded here)", () => {
	const drawnDistance = (
		body: Body,
		distanceKm: number,
		scale: ScaleSettings,
	) => {
		const parent = parentOf(body)
		return displayDistanceKm(
			distanceKm,
			parent.radiusKm,
			displayRadiusKm(parent.radiusKm, sun.radiusKm, scale.bodySize),
			childDistanceCurve(scale, parent.parentId === null),
		)
	}
	const drawnRadius = (body: Body, scale: ScaleSettings) =>
		displayRadiusKm(body.radiusKm, sun.radiusKm, scale.bodySize)
	const peri = (body: Body) =>
		(body.orbit?.semiMajorAxisKm ?? 0) * (1 - (body.orbit?.eccentricity ?? 0))
	const apo = (body: Body) =>
		(body.orbit?.semiMajorAxisKm ?? 0) * (1 + (body.orbit?.eccentricity ?? 0))

	it("is the default preset", () => {
		expect(DEFAULT_SCALE_PRESET).toBe("everythingVisible")
	})

	for (const id of ["textbook", "bigPlanets", "everythingVisible"] as const) {
		const scale = SCALE_PRESETS[id]

		it(`${id}: planet orbits keep their order, clear the Sun and never touch`, () => {
			let previousOuter = drawnRadius(sun, scale)
			for (const planet of planets) {
				const inner =
					drawnDistance(planet, peri(planet), scale) -
					drawnRadius(planet, scale)
				expect(inner).toBeGreaterThan(previousOuter)
				previousOuter =
					drawnDistance(planet, apo(planet), scale) + drawnRadius(planet, scale)
			}
		})

		it(`${id}: every moon system stays within half the gap to the neighbouring planets' orbits`, () => {
			planets.forEach((planet, i) => {
				const moons = bodies.filter((b) => b.parentId === planet.id)
				if (moons.length === 0) return
				const extent = Math.max(
					...moons.map(
						(m) => drawnDistance(m, apo(m), scale) + drawnRadius(m, scale),
					),
				)
				const a = (b: Body) =>
					drawnDistance(b, b.orbit?.semiMajorAxisKm ?? 0, scale)
				const gaps: number[] = []
				if (i > 0) gaps.push(a(planet) - a(planets[i - 1]))
				if (i < planets.length - 1) gaps.push(a(planets[i + 1]) - a(planet))
				expect(extent).toBeLessThan(Math.min(...gaps) / 2)
			})
		})

		it(`${id}: no two major moons (radius >= 150 km) ever touch`, () => {
			for (const planet of planets) {
				const major = bodies
					.filter((b) => b.parentId === planet.id && b.radiusKm >= 150)
					.sort(
						(a, b) =>
							(a.orbit?.semiMajorAxisKm ?? 0) - (b.orbit?.semiMajorAxisKm ?? 0),
					)
				for (let k = 1; k < major.length; k++) {
					const gap =
						drawnDistance(major[k], peri(major[k]), scale) -
						drawnDistance(major[k - 1], apo(major[k - 1]), scale)
					expect(gap).toBeGreaterThan(
						1.2 *
							(drawnRadius(major[k], scale) + drawnRadius(major[k - 1], scale)),
					)
				}
			}
		})
	}

	it("keeps rings and ring moons in true proportion to their planet", () => {
		// every ring edge and every moon inside the knee: drawn distance / drawn radius == true ratio
		const knee = EV.moonDistance.knee
		for (const planet of planets) {
			if (planet.rings !== null)
				expect(planet.rings.outerRadiusKm / planet.radiusKm).toBeLessThan(knee)
			for (const moon of bodies.filter((b) => b.parentId === planet.id)) {
				const n = (moon.orbit?.semiMajorAxisKm ?? 0) / planet.radiusKm
				if (n > knee) continue
				expect(mapDistance(EV.moonDistance, n)).toBe(n)
			}
		}
		// Pan sits in the Encke gap, inside the A ring, exactly as in reality:
		// the drawn ring (displayBodyLengthKm) and the drawn moon (the moon curve) agree
		const pan = getBody("pan")
		const saturn = getBody("saturn")
		const saturnDrawn = displayRadiusKm(
			saturn.radiusKm,
			sun.radiusKm,
			EV.bodySize,
		)
		const ringOuter = displayBodyLengthKm(
			saturn.rings?.outerRadiusKm ?? 0,
			saturn.radiusKm,
			saturnDrawn,
		)
		const panDrawn = displayDistanceKm(
			pan.orbit?.semiMajorAxisKm ?? 0,
			saturn.radiusKm,
			saturnDrawn,
			EV.moonDistance,
		)
		expect(panDrawn / ringOuter).toBeCloseTo(
			(pan.orbit?.semiMajorAxisKm ?? 0) / (saturn.rings?.outerRadiusKm ?? 1),
			12,
		)
		expect(panDrawn).toBeLessThan(ringOuter)
		expect(displayBodyLengthKm(100, 10, 30)).toBe(300)
	})

	it("makes the lie legible: planets big enough to see, distances pulled in", () => {
		const earth = getBody("earth")
		const neptune = getBody("neptune")
		// Earth is drawn about ten times too big, Neptune about 67 times too close
		expect(
			sizeExaggeration(earth.radiusKm, sun.radiusKm, EV.bodySize),
		).toBeGreaterThan(5)
		const n = (neptune.orbit?.semiMajorAxisKm ?? 0) / sun.radiusKm
		expect(1 / distanceFactor(EV.orbitDistance, n)).toBeGreaterThan(30)
		// our Moon (60 Earth radii out) is gathered close to Earth
		const moon = getBody("moon")
		const moonOut =
			drawnDistance(moon, moon.orbit?.semiMajorAxisKm ?? 0, EV) /
			drawnRadius(earth, EV)
		expect(moonOut).toBeGreaterThan(4)
		expect(moonOut).toBeLessThan(12)
	})
})

describe("presets and settings", () => {
	it("exposes true scale, textbook, big planets, everything visible and poster, frozen", () => {
		expect(SCALE_PRESET_IDS).toEqual([
			"trueScale",
			"textbook",
			"bigPlanets",
			"everythingVisible",
			"poster",
		])
		for (const [, scale] of presets) {
			expect(isValidScale(scale)).toBe(true)
			expect(Object.isFrozen(scale)).toBe(true)
			expect(Object.isFrozen(scale.moonDistance)).toBe(true)
		}
		expect(isTrueScale(TRUE_SCALE)).toBe(true)
		expect(isTrueScale(EV)).toBe(false)
		expect(isScalePresetId("textbook")).toBe(true)
		expect(isScalePresetId("toString")).toBe(false)
		expect(isScalePresetId(3)).toBe(false)
	})

	it("recognises a preset by value", () => {
		expect(presetOf({ ...EV, bodySize: { exponent: 0.5 } })).toBe(
			"everythingVisible",
		)
		expect(presetOf({ ...EV, bodySize: { exponent: 0.51 } })).toBeNull()
		expect(sameScale(TRUE_SCALE, SCALE_PRESETS.trueScale)).toBe(true)
	})

	it("rejects settings that would break the model", () => {
		const bad: ScaleSettings[] = [
			{ ...EV, bodySize: { exponent: 0 } },
			{ ...EV, bodySize: { exponent: Number.NaN } },
			{ ...EV, moonDistance: { ...EV.moonDistance, knee: 0.5 } },
			{ ...EV, orbitDistance: { ...EV.orbitDistance, gain: -1 } },
			{ ...EV, orbitDistance: { ...EV.orbitDistance, exponent: Infinity } },
		]
		for (const scale of bad) expect(isValidScale(scale)).toBe(false)
		expect(isValidScale(undefined)).toBe(false)
	})

	it("interpolates smoothly between presets and lands exactly on them", () => {
		const from = TRUE_SCALE
		const to = EV
		expect(interpolateScale(from, to, 0)).toBe(from)
		expect(interpolateScale(from, to, 1)).toBe(to)
		expect(interpolateScale(from, to, -3)).toBe(from)
		expect(interpolateScale(from, to, Number.NaN)).toBe(from)
		const half = interpolateScale(from, to, 0.5)
		expect(isValidScale(half)).toBe(true)
		expect(half.bodySize.exponent).toBeCloseTo(0.75, 12)
		// gains blend geometrically
		expect(half.moonDistance.gain).toBeCloseTo(Math.sqrt(2), 12)
		expect(presetOf(half)).toBeNull()
		// Neptune's drawn distance moves monotonically from the truth to the preset
		const n = (getBody("neptune").orbit?.semiMajorAxisKm ?? 0) / sun.radiusKm
		let previous = Infinity
		for (let t = 0; t <= 1.0001; t += 0.1) {
			const d = mapDistance(interpolateScale(from, to, t).orbitDistance, n)
			expect(d).toBeLessThan(previous)
			previous = d
		}
	})
})
