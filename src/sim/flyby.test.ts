/**
 * The drawn copy of a flyby's hyperbola (#56), on a made-up pass of Jupiter in
 * every scale preset: the drawn closest approach on the moon curve at the true
 * instant, the true direction of motion near the planet (so the true turn),
 * the drawn time and its inverse, the true path at true scale. The real
 * passages are tested in src/data/spacecraft.test.ts.
 */
import { describe, expect, it } from "vitest"

import { bodies, getBody } from "@/data"

import {
	CATCH_FADE_TO,
	CATCH_FROM,
	COMPACT_POWER,
	COMPACT_RATE,
	GRAVITATIONAL_CONSTANT,
	SKEW_FROM,
	buildFlybyTable,
	catchShare,
	compactShare,
	coreShare,
	drawnAnomalyAt,
	drawnShape,
	drawnTimeAt,
	hyperbolicAnomaly,
	osculatingHyperbola,
	prepareFlyby,
	trueTimeAt,
	turnAngle,
	type FlybyGeometry,
	type Hyperbola,
} from "./flyby"
import {
	SCALE_PRESETS,
	SCALE_PRESET_IDS,
	computeDisplayRadii,
	mapDistance,
} from "./scale"
import { SECONDS_PER_DAY } from "./units"

const jupiter = getBody("jupiter")
const sun = getBody("sun")
const MU = GRAVITATIONAL_CONSTANT * jupiter.massKg!
const R = jupiter.radiusKm
const TP = 2443937.5
const AU = 1.495978707e8

/** The point and velocity of `hyperbola` at anomaly F, in scene axes. */
function stateAt(hyperbola: Hyperbola, F: number) {
	const { a, b, e, n, p, q } = hyperbola
	const x = a * (e - Math.cosh(F))
	const y = b * Math.sinh(F)
	const rate = n / (e * Math.cosh(F) - 1)
	const vx = -a * Math.sinh(F) * rate
	const vy = b * Math.cosh(F) * rate
	return {
		position: [0, 1, 2].map((k) => x * p[k] + y * q[k]),
		velocity: [0, 1, 2].map((k) => vx * p[k] + vy * q[k]),
	}
}

/** A Voyager-like pass: periapsis 5 radii out, at 15 degrees to the ecliptic. */
function passage(periapsisRadii = 5, e = 1.3) {
	const rp = periapsisRadii * R
	const speed = Math.sqrt((MU * (1 + e)) / rp)
	const tilt = (15 * Math.PI) / 180
	const hyperbola = osculatingHyperbola(
		[rp, 0, 0],
		[0, speed * Math.sin(tilt), speed * Math.cos(tilt)],
		TP,
		MU,
	)!
	const coreKm = Math.max(3 * R, 1.2 * rp)
	const reach = Math.acosh(((2000 * coreKm) / hyperbola.a + 1) / e)
	const window: [number, number] = [TP - 500, TP + 400]
	const edgeKm = window.map((jd) => {
		const F = hyperbolicAnomaly(e, (jd - TP) * SECONDS_PER_DAY * hyperbola.n)
		return hyperbola.a * (e * Math.cosh(F) - 1)
	}) as [number, number]
	const geometry: FlybyGeometry = {
		hyperbola,
		table: buildFlybyTable(
			hyperbola,
			coreKm,
			Math.max(rp, 1.1 * jupiter.rings!.outerRadiusKm),
			-reach,
			reach,
			null,
			edgeKm,
		),
		anchorJD: TP,
		anchorF: 0,
		sunKm: 5.2 * AU,
		sunDirection: Float64Array.of(Math.SQRT1_2, 0, -Math.SQRT1_2),
		window,
	}
	return { hyperbola, geometry }
}

const { hyperbola, geometry } = passage()
const jupiterIndex = bodies.indexOf(jupiter)
const sunIndex = bodies.indexOf(sun)
const scaled = (presetId: (typeof SCALE_PRESET_IDS)[number]) => {
	const scale = SCALE_PRESETS[presetId]
	const radii = computeDisplayRadii(bodies, scale)
	const planet = {
		radiusKm: R,
		displayRadiusKm: radii[jupiterIndex],
		rootRadiusKm: sun.radiusKm,
		rootDisplayRadiusKm: radii[sunIndex],
	}
	return { scale, planet, prepared: prepareFlyby(geometry, scale, planet) }
}
const shape = (prepared: ReturnType<typeof scaled>["prepared"], F: number) => {
	const out = new Float64Array(3)
	drawnShape(geometry, prepared, F, out)
	return out
}
const norm = (v: ArrayLike<number>) => Math.hypot(v[0], v[1], v[2])
const angle = (u: ArrayLike<number>, v: ArrayLike<number>) =>
	Math.acos(
		Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / norm(u) / norm(v)),
	)

describe("osculatingHyperbola", () => {
	it("recovers the hyperbola, its periapsis time and its turn from any state on it", () => {
		for (const F of [-2, -0.4, 0.7, 3]) {
			const { position, velocity } = stateAt(hyperbola, F)
			const jd = trueTimeAt(hyperbola, F)
			const again = osculatingHyperbola(position, velocity, jd, MU)!
			expect(again.e).toBeCloseTo(1.3, 9)
			expect(again.rp / R).toBeCloseTo(5, 9)
			expect((again.tp - TP) * SECONDS_PER_DAY).toBeCloseTo(0, 3)
			expect(angle(again.p, hyperbola.p)).toBeLessThan(1e-9)
		}
		// the legs are as far apart as the gravity assist turned the craft
		expect(angle(hyperbola.uIn, hyperbola.uOut)).toBeCloseTo(
			turnAngle(hyperbola),
			12,
		)
	})

	it("is null for a bound orbit", () => {
		const rp = 5 * R
		const circular = Math.sqrt(MU / rp)
		expect(
			osculatingHyperbola([rp, 0, 0], [0, 0, 1.2 * circular], TP, MU),
		).toBeNull()
	})
})

describe("hyperbolicAnomaly", () => {
	it("solves Kepler's equation for a hyperbola", () => {
		for (const e of [1.01, 1.3, 9]) {
			for (const M of [-1e4, -30, -1, 0, 0.2, 5, 1e5]) {
				const F = hyperbolicAnomaly(e, M)
				expect(e * Math.sinh(F) - F).toBeCloseTo(M, 6)
			}
		}
	})
})

describe("the drawn passage", () => {
	it("is the true path at true scale", () => {
		const { prepared } = scaled("trueScale")
		expect(prepared.identity).toBe(true)
		for (const F of [-6, -1, 0, 0.5, 4]) {
			const { position } = stateAt(hyperbola, F)
			const drawn = shape(prepared, F)
			for (let k = 0; k < 3; k++) {
				expect(drawn[k] / R).toBeCloseTo(position[k] / R, 6)
			}
			expect(drawnTimeAt(geometry, prepared, F)).toBeCloseTo(
				trueTimeAt(hyperbola, F),
				6,
			)
		}
	})

	it.each(SCALE_PRESET_IDS)(
		"passes closest at the true instant, where the moon curve draws the true distance, in %s",
		(presetId) => {
			const { scale, planet, prepared } = scaled(presetId)
			const periapsisKm =
				planet.displayRadiusKm * mapDistance(scale.moonDistance, 5)
			expect(prepared.periapsisKm).toBeCloseTo(periapsisKm, 6)
			const vertex = shape(prepared, 0)
			expect(norm(vertex) / periapsisKm).toBeCloseTo(1, 9)
			expect(angle(vertex, hyperbola.p)).toBeLessThan(1e-9)
			expect(drawnTimeAt(geometry, prepared, 0)).toBeCloseTo(TP, 9)
			// nowhere nearer the drawn planet
			for (let F = -4; F <= 4; F += 0.01) {
				expect(norm(shape(prepared, F))).toBeGreaterThanOrEqual(
					periapsisKm * (1 - 1e-9),
				)
			}
		},
	)

	it.each(SCALE_PRESET_IDS)(
		"moves in the true direction near the planet, so turns by the true angle, in %s",
		(presetId) => {
			const { prepared } = scaled(presetId)
			const { a, e } = hyperbola
			const skewF = Math.acosh(
				((SKEW_FROM * geometry.table.coreKm) / a + 1) / e,
			)
			const h = 1e-5
			for (let F = -skewF; F <= skewF; F += skewF / 20) {
				const before = shape(prepared, F - h)
				const after = shape(prepared, F + h)
				const drawn = [0, 1, 2].map((k) => after[k] - before[k])
				const { velocity } = stateAt(hyperbola, F)
				// (to the tables' interpolation: under a hundredth of a degree)
				expect(angle(drawn, velocity), `F ${F}`).toBeLessThan(3e-4)
			}
		},
	)

	it.each(SCALE_PRESET_IDS)(
		"runs forward in time, and finds the drawn craft at any instant, in %s",
		(presetId) => {
			const { prepared } = scaled(presetId)
			let last = -Infinity
			for (let F = -8; F <= 8; F += 0.05) {
				const t = drawnTimeAt(geometry, prepared, F)
				expect(t).toBeGreaterThan(last)
				last = t
				expect(drawnAnomalyAt(geometry, prepared, t)).toBeCloseTo(F, 8)
			}
			// out of order too (the solver starts from its last answer)
			for (const F of [3, -7, 0.01, 6, -0.5]) {
				const t = drawnTimeAt(geometry, prepared, F)
				expect(drawnAnomalyAt(geometry, prepared, t)).toBeCloseTo(F, 8)
			}
		},
	)
})

describe("the drawing's shares", () => {
	it("keeps the compact core true out to its radius, and falls off no slower than its rate", () => {
		const { compactKm } = geometry.table
		expect(compactShare(hyperbola, compactKm, 0.5 * compactKm)).toBe(1)
		expect(compactShare(hyperbola, compactKm, compactKm)).toBe(1)
		let last = 1
		for (let r = compactKm; r < 1e4 * compactKm; r *= 1.1) {
			const share = compactShare(hyperbola, compactKm, r)
			expect(share).toBeLessThanOrEqual(last)
			expect(share).toBeGreaterThanOrEqual(
				coreShare(compactKm, r, COMPACT_RATE, COMPACT_POWER),
			)
			last = share
		}
	})

	it("catches up only on the legs, inside the window", () => {
		const { coreKm } = geometry.table
		const edge = 1e4 * coreKm
		expect(catchShare(geometry.table, edge, CATCH_FROM * coreKm)).toBe(0)
		expect(catchShare(geometry.table, edge, CATCH_FADE_TO * edge)).toBe(0)
		for (let r = coreKm; r < edge; r *= 1.05) {
			const share = catchShare(geometry.table, edge, r)
			expect(share).toBeGreaterThanOrEqual(0)
			expect(share).toBeLessThanOrEqual(1)
		}
	})
})
