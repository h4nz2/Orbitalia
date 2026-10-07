/**
 * The spacecraft data contract (issue #35): the generated files match their
 * schema and the curated catalogue, the trajectories rebuild the JPL Horizons
 * states within the stated tolerance, cover their whole time range without a
 * gap, never jump where the frame hands over from the Sun to a planet in any
 * scale preset, and put known events where they happened. And every planet
 * passage looks like one in every preset (#56): the true bend, no sharp turn,
 * the closest approach outside the drawn planet and on the right side of its
 * moons' drawn orbits.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
	AU_KM,
	SCALE_PRESETS,
	SCALE_PRESET_IDS,
	buildIndex,
	childDistanceCurve,
	computeDisplayPositions,
	computeDisplayRadii,
	computePositions,
	displayOffset,
	mapDistance,
	propagate,
	type ScalePresetId,
	type ScaleSettings,
} from "@/sim"
import {
	SKEW_FROM,
	drawnAnomalyAt,
	drawnTimeAt,
	nearWeight,
	trueTimeAt,
} from "@/sim/flyby"
import {
	craftStateAt,
	createCentresAt,
	createCraftState,
	decodeTrajectory,
	flybyScaleOf,
	isoToJD,
	segmentState,
	type CentreFrame,
	type CraftEncounter,
	type CraftTrajectory,
} from "@/sim/spacecraft"

import { SPEED_OF_LIGHT_KM_S } from "@/sim/light"

import { bodies } from "."
import checks from "./spacecraftCheck.json"
import {
	SPACECRAFT_EXTRA_TARGETS,
	SpacecraftFile,
	TrajectoriesFile,
} from "./spacecraftSchema"
import catalogueJson from "./spacecraft.json"
import trajectoriesJson from "./spacecraftTrajectories.json"

const catalogue = SpacecraftFile.parse(catalogueJson)
const trajectories = TrajectoriesFile.parse(trajectoriesJson)
const index = buildIndex(bodies)
const source = JSON.parse(
	readFileSync(join(__dirname, "..", "..", "data", "spacecraft.json"), "utf8"),
) as { craft: { id: string; events: unknown[] }[] }

const decoded = new Map<string, CraftTrajectory>(
	catalogue.craft.map((craft) => [
		craft.id,
		decodeTrajectory(craft, trajectories[craft.id], bodies, index),
	]),
)
const trajectoryOf = (id: string): CraftTrajectory => decoded.get(id)!

/** Bodies at `jd` under `scale`, as the scene's SimFrame has them. */
function frameAt(jd: number, scale: ScaleSettings): CentreFrame {
	const positionsKm = computePositions(bodies, jd, undefined, index)
	const displayRadiiKm = computeDisplayRadii(bodies, scale)
	return {
		bodies,
		positionsKm,
		displayKm: computeDisplayPositions(
			bodies,
			positionsKm,
			displayRadiiKm,
			scale,
			index,
		),
		displayRadiiKm,
		scale,
	}
}

const trueScale = SCALE_PRESETS.trueScale
const at = (id: string, iso: string, scale: ScaleSettings = trueScale) => {
	const jd = isoToJD(iso)
	const frame = frameAt(jd, scale)
	const state = craftStateAt(trajectoryOf(id), jd, frame, createCraftState())
	return { state, frame }
}
const bodyKm = (frame: CentreFrame, id: string) => {
	const i = index.get(id)! * 3
	return [
		frame.positionsKm[i],
		frame.positionsKm[i + 1],
		frame.positionsKm[i + 2],
	]
}
const dist = (a: ArrayLike<number>, b: ArrayLike<number>) =>
	Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

describe("src/data/spacecraft.json and spacecraftTrajectories.json", () => {
	it("hold the catalogue's craft, in its order, each with a trajectory", () => {
		expect(catalogue.craft.map((c) => c.id)).toEqual(
			source.craft.map((c) => c.id),
		)
		expect(Object.keys(trajectories).sort()).toEqual(
			catalogue.craft.map((c) => c.id).sort(),
		)
		for (const craft of catalogue.craft) {
			expect(craft.events.length).toBe(
				source.craft.find((c) => c.id === craft.id)!.events.length,
			)
		}
	})

	it("launch before the data starts, and the data covers a range", () => {
		for (const craft of catalogue.craft) {
			expect(isoToJD(craft.launch)).toBeLessThanOrEqual(isoToJD(craft.dataFrom))
			expect(isoToJD(craft.dataTo)).toBeGreaterThan(isoToJD(craft.dataFrom))
			if (craft.end !== null) {
				expect(isoToJD(craft.end.date)).toBeGreaterThan(isoToJD(craft.launch))
			}
		}
	})

	it("name only known targets", () => {
		const extra = new Set<string>(SPACECRAFT_EXTRA_TARGETS)
		for (const craft of catalogue.craft) {
			for (const event of craft.events) {
				if (event.target === undefined) continue
				expect(
					index.has(event.target) || extra.has(event.target),
					`${craft.id}: ${event.target}`,
				).toBe(true)
			}
			for (const orbit of craft.orbits)
				expect(index.has(orbit.center)).toBe(true)
		}
	})

	it("centre every segment on the Sun or a planet", () => {
		for (const [id, segments] of Object.entries(trajectories)) {
			for (const segment of segments) {
				const body = bodies[index.get(segment.center)!]
				expect(
					body.parentId === null || body.kind === "planet",
					`${id}: ${segment.center}`,
				).toBe(true)
				if (segment.blend !== null) {
					expect(segment.blend[0]).toBeLessThan(segment.blend[1])
				}
			}
		}
	})
})

describe("trajectory accuracy", () => {
	it("rebuilds the Horizons states it dropped within the tolerance", () => {
		expect(checks.length).toBeGreaterThan(100)
		const p = new Float64Array(3)
		for (const check of checks) {
			const trajectory = trajectoryOf(check.craft)
			const segments = [...trajectory.helio, ...trajectory.planetary]
			// check points name segments in file order
			const raw = trajectories[check.craft][check.segment]
			const segment = segments.find(
				(s) =>
					s.center === raw.center &&
					s.from === raw.t[0] + 2451545 &&
					s.jd.length === raw.t.length,
			)!
			segmentState(segment, check.t + 2451545, p)
			// scene (x, y, z) = ecliptic (x, z, -y)
			const error = Math.hypot(
				p[0] - check.p[0],
				p[1] - check.p[2],
				p[2] + check.p[1],
			)
			// the tolerance, plus the rounding of the stored samples
			expect(
				error,
				`${check.craft} #${check.segment} @${check.t}`,
			).toBeLessThan(check.tolKm * 1.05 + 5)
		}
	})

	// one test per craft: each samples 4001 instants, each a whole frame of bodies,
	// which together took longer than a test's time limit on a loaded machine
	it.each(catalogue.craft.map((craft) => craft.id))(
		"%s has a position at every instant of the data range, with no gap",
		(id) => {
			const trajectory = trajectoryOf(id)
			const state = createCraftState()
			const steps = 4000
			for (let k = 0; k <= steps; k++) {
				const jd =
					trajectory.fromJD +
					((trajectory.toJD - trajectory.fromJD) * k) / steps
				craftStateAt(trajectory, jd, frameAt(jd, trueScale), state)
				expect(state.available, `${id} @${jd}`).toBe(true)
				expect(state.trueKm.every(Number.isFinite)).toBe(true)
			}
		},
	)

	it("has no position outside the data range", () => {
		const trajectory = trajectoryOf("voyager1")
		const state = createCraftState()
		craftStateAt(
			trajectory,
			trajectory.fromJD - 1,
			frameAt(trajectory.fromJD - 1, trueScale),
			state,
		)
		expect(state.available).toBe(false)
	})

	it.each(SCALE_PRESET_IDS)(
		"never jumps where a segment hands over, in %s",
		(presetId) => {
			const scale = SCALE_PRESETS[presetId]
			const dt = 1 / 1440
			for (const craft of catalogue.craft) {
				const trajectory = trajectoryOf(craft.id)
				const drawn = (jd: number) =>
					craftStateAt(
						trajectory,
						jd,
						frameAt(jd, scale),
						createCraftState(),
					).displayKm.slice()
				// segment edges, and where a planet's passage begins, ends, or
				// turns from a bound orbit to the passage or back (#56)
				const edges = [
					...[...trajectory.helio, ...trajectory.planetary].flatMap((s) => [
						s.from,
						s.to,
					]),
					...trajectory.encounters.flatMap((e) => [
						e.from,
						e.to,
						e.hyperFrom,
						e.hyperTo,
					]),
				]
				for (const edge of edges) {
					if (
						edge - 3 * dt <= trajectory.fromJD ||
						edge + 3 * dt >= trajectory.toJD
					) {
						continue
					}
					// the step across the edge is no bigger than the steps beside it:
					// a hand-over that jumped would show as a spike
					const [a, b, c, d] = [-3, -1, 1, 3].map((k) => drawn(edge + k * dt))
					const across = dist(b, c)
					const beside = Math.max(dist(a, b), dist(c, d))
					expect(across, `${craft.id} @${edge}`).toBeLessThan(3 * beside + 1)
				}
			}
		},
	)
})

describe("where the craft are", () => {
	it("puts Voyager 1 at the heliopause, 121-122 AU out, on 25 August 2012", () => {
		const { state, frame } = at("voyager1", "2012-08-25T12:00Z")
		const au = dist(state.trueKm, bodyKm(frame, "sun")) / AU_KM
		expect(au).toBeGreaterThan(121)
		expect(au).toBeLessThan(122.5)
	})

	it("puts Voyager 1 about a light-day away in 2026", () => {
		const { state, frame } = at("voyager1", "2026-11-15T00:00Z")
		const hours =
			dist(state.trueKm, bodyKm(frame, "earth")) / SPEED_OF_LIGHT_KM_S / 3600
		expect(hours).toBeGreaterThan(22.5)
		expect(hours).toBeLessThan(25)
	})

	it("keeps JWST around L2, 1.2-1.9 million km beyond Earth, away from the Sun", () => {
		for (const iso of [
			"2023-01-01T00:00Z",
			"2025-06-01T00:00Z",
			"2026-09-25T00:00Z",
		]) {
			const { state, frame } = at("jwst", iso)
			const earth = bodyKm(frame, "earth")
			const d = dist(state.trueKm, earth)
			expect(d).toBeGreaterThan(1.2e6)
			expect(d).toBeLessThan(1.9e6)
			// farther from the Sun than Earth
			expect(dist(state.trueKm, bodyKm(frame, "sun"))).toBeGreaterThan(
				dist(earth, bodyKm(frame, "sun")),
			)
		}
	})

	it("brings Parker Solar Probe within 7 million km of the Sun's centre on 24 December 2024", () => {
		const { state, frame } = at("parker", "2024-12-24T11:53Z")
		const d = dist(state.trueKm, bodyKm(frame, "sun"))
		expect(d).toBeGreaterThan(6.8e6)
		expect(d).toBeLessThan(7.0e6)
	})

	it("keeps Juno within a few million km of the drawn Jupiter", () => {
		const { state, frame } = at("juno", "2026-09-25T00:00Z")
		expect(dist(state.trueKm, bodyKm(frame, "jupiter"))).toBeLessThan(9e6)
	})

	it("passes every planet it flew by at the recorded distance, from the drawn planet", () => {
		let checked = 0
		for (const craft of catalogue.craft) {
			for (const event of craft.events) {
				if (event.kind !== "flyby" || event.distanceKm === undefined) continue
				const { state, frame } = at(craft.id, event.date)
				const d = dist(state.trueKm, bodyKm(frame, event.target!))
				// the event is rounded to the minute, the path to its tolerance
				expect(
					Math.abs(d / event.distanceKm - 1),
					`${craft.id} ${event.target}`,
				).toBeLessThan(0.02)
				checked++
			}
		}
		// Voyager 2 alone passed four planets
		expect(checked).toBeGreaterThanOrEqual(20)
	})

	it("passes the drawn planet at the true miss distance, scaled like a moon, in every preset", () => {
		// Voyager 2 at Neptune: 29,240 km from the centre, 1.19 Neptune radii
		for (const presetId of SCALE_PRESET_IDS) {
			const { state, frame } = at(
				"voyager2",
				"1989-08-25T03:56Z",
				SCALE_PRESETS[presetId],
			)
			const n = index.get("neptune")! * 3
			const drawn = Math.hypot(
				state.displayKm[0] - frame.displayKm[n],
				state.displayKm[1] - frame.displayKm[n + 1],
				state.displayKm[2] - frame.displayKm[n + 2],
			)
			const radii = drawn / frame.displayRadiiKm[index.get("neptune")!]
			// inside the moon curves' knee (3 radii) distances keep true proportion
			expect(radii, presetId).toBeCloseTo(29240 / 24622, 1)
		}
	})
})

/** Every planet passage drawn as a hyperbola, of the given kinds. */
const passages = (kinds: readonly CraftEncounter["kind"][]) =>
	catalogue.craft.flatMap((craft) =>
		trajectoryOf(craft.id)
			.encounters.filter((e) => e.flyby !== null && kinds.includes(e.kind))
			.map((encounter) => ({
				craft: craft.id,
				trajectory: trajectoryOf(craft.id),
				encounter,
				label: `${craft.id} at ${bodies[encounter.planet].id} (${encounter.kind})`,
			})),
	)

/**
 * A passage's samples as the path builder draws them under `scale`: the
 * craft's drawn and true position, the planet's, at instants spaced by a
 * growing step from periapsis out to the passage's ends.
 */
function sampled(
	trajectory: CraftTrajectory,
	encounter: CraftEncounter,
	scale: ScaleSettings,
	growth = 1.02,
) {
	const { hyperbola } = encounter.flyby!
	const lo = Math.max(encounter.from, encounter.hyperFrom)
	const hi = Math.min(encounter.to, encounter.hyperTo)
	const times: number[] =
		hyperbola.tp >= lo && hyperbola.tp <= hi ? [hyperbola.tp] : []
	for (const side of [-1, 1]) {
		for (let dt = 1 / 1440; dt < 4000; dt *= growth) {
			const t = hyperbola.tp + side * dt
			if (t >= lo && t <= hi) times.push(t)
		}
	}
	times.sort((a, b) => a - b)
	const frame = frameAt(encounter.flyby!.anchorJD, scale)
	const root = trajectory.root
	const centres = createCentresAt(root)
	const state = createCraftState()
	const planet = bodies[encounter.planet]
	const at = { x: 0, y: 0, z: 0 }
	const mapped = new Float64Array(3)
	const n = times.length
	const drawn = new Float64Array(n * 3)
	const drawnPlanet = new Float64Array(n * 3)
	const trueOffset = new Float64Array(n * 3)
	const sunOnly = new Float64Array(n * 3)
	const rootKm = bodies[root].radiusKm
	const rootDrawnKm = frame.displayRadiiKm[root]
	const curve = childDistanceCurve(scale, true)
	for (let k = 0; k < n; k++) {
		centres.jd = times[k]
		craftStateAt(trajectory, times[k], frame, state, centres.lookup)
		propagate(planet.orbit!, times[k], at)
		displayOffset(at.x, at.y, at.z, rootKm, rootDrawnKm, curve, mapped)
		const r = root * 3
		const relative: [number, number, number] = [
			state.trueKm[0] - frame.positionsKm[r],
			state.trueKm[1] - frame.positionsKm[r + 1],
			state.trueKm[2] - frame.positionsKm[r + 2],
		]
		const o = k * 3
		trueOffset[o] = relative[0] - at.x
		trueOffset[o + 1] = relative[1] - at.y
		trueOffset[o + 2] = relative[2] - at.z
		for (let c = 0; c < 3; c++) {
			drawn[o + c] = state.displayKm[c]
			drawnPlanet[o + c] = frame.displayKm[root * 3 + c] + mapped[c]
		}
		// what the Sun-centred map alone draws there (before #56, between planets)
		displayOffset(...relative, rootKm, rootDrawnKm, curve, mapped)
		for (let c = 0; c < 3; c++) {
			sunOnly[o + c] = frame.displayKm[root * 3 + c] + mapped[c]
		}
	}
	return { times, frame, drawn, drawnPlanet, trueOffset, sunOnly }
}

const sub3 = (v: ArrayLike<number>, i: number, j: number) => [
	v[i * 3] - v[j * 3],
	v[i * 3 + 1] - v[j * 3 + 1],
	v[i * 3 + 2] - v[j * 3 + 2],
]
const turnOf = (a: number[], b: number[]) => {
	const la = Math.hypot(a[0], a[1], a[2])
	const lb = Math.hypot(b[0], b[1], b[2])
	if (!(la > 0 && lb > 0)) return 0
	const cos = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb)
	return Math.acos(Math.max(-1, Math.min(1, cos)))
}

/**
 * The sharpest turn of a drawn passage that the Sun-centred map's drawing of
 * the same path does not have (the planet's pull, Parker's turns round the
 * Sun): the turn between neighbouring steps per step length, times the
 * distance from the drawn planet (so 1 is a circle round it). Steps are at
 * least 1% of that distance; only where the craft is near the planet.
 */
function sharpestTurn(
	trajectory: CraftTrajectory,
	encounter: CraftEncounter,
	presetId: ScalePresetId,
) {
	const scale = SCALE_PRESETS[presetId]
	const { times, frame, drawn, drawnPlanet, trueOffset, sunOnly } = sampled(
		trajectory,
		encounter,
		scale,
	)
	const prepared = flybyScaleOf(trajectory, encounter, frame)!
	const tp = encounter.flyby!.hyperbola.tp
	const distance = (k: number) =>
		Math.hypot(
			drawn[k * 3] - drawnPlanet[k * 3],
			drawn[k * 3 + 1] - drawnPlanet[k * 3 + 1],
			drawn[k * 3 + 2] - drawnPlanet[k * 3 + 2],
		)
	const kept = [0]
	for (let k = 1; k < times.length; k++) {
		const step = Math.hypot(...sub3(drawn, k, kept[kept.length - 1]))
		if (step >= 0.01 * distance(k)) kept.push(k)
	}
	let worst = 0
	let where = ""
	for (let i = 1; i + 1 < kept.length; i++) {
		const [k0, k, k1] = [kept[i - 1], kept[i], kept[i + 1]]
		const side = times[k] < tp ? 0 : 1
		const near = Math.hypot(
			trueOffset[k * 3],
			trueOffset[k * 3 + 1],
			trueOffset[k * 3 + 2],
		)
		if (near > 1.5 * prepared.farKm[side]) continue
		const a = sub3(drawn, k, k0)
		const b = sub3(drawn, k1, k)
		const own =
			turnOf(a, b) - turnOf(sub3(sunOnly, k, k0), sub3(sunOnly, k1, k))
		const length = (Math.hypot(...a) + Math.hypot(...b)) / 2
		const sharpness = (Math.max(0, own) * distance(k)) / length
		if (sharpness > worst) {
			worst = sharpness
			where = `${(times[k] - tp).toFixed(1)} d from periapsis`
		}
	}
	return { worst, where }
}

/** No sharper than this anywhere ... */
const SHARPEST = 10
/**
 * ... but where Poster's planets, drawn up to thousands of times bigger than
 * the Sun-centred map draws their neighbourhoods, leave a short window for the
 * hand-over: tight bends, no corners (docs/ARCHITECTURE.md, "Spacecraft").
 */
const POSTER_SHARPEST: Record<string, number> = {
	"cassini at jupiter (flyby)": 40,
	"voyager2 at neptune (flyby)": 30,
	"voyager2 at saturn (flyby)": 20,
	"voyager2 at uranus (flyby)": 15,
}

describe("planet passages, drawn (#56)", () => {
	const flybys = passages(["flyby"])

	it("are drawn for every flyby, departure and arrival in the data", () => {
		expect(flybys.length).toBeGreaterThanOrEqual(24)
		expect(passages(["departure"]).length).toBeGreaterThanOrEqual(9)
		expect(passages(["arrival"]).length).toBe(3)
	})

	it("are the true path at true scale", () => {
		for (const { trajectory, encounter, label } of passages([
			"flyby",
			"departure",
			"arrival",
		])) {
			const { drawn, frame, times } = sampled(
				trajectory,
				encounter,
				trueScale,
				1.3,
			)
			const state = createCraftState()
			const centres = createCentresAt(trajectory.root)
			for (let k = 0; k < times.length; k++) {
				centres.jd = times[k]
				craftStateAt(trajectory, times[k], frame, state, centres.lookup)
				const r = trajectory.root * 3
				for (let c = 0; c < 3; c++) {
					const truth =
						state.trueKm[c] - frame.positionsKm[r + c] + frame.displayKm[r + c]
					expect(Math.abs(drawn[k * 3 + c] - truth), label).toBeLessThan(1)
				}
			}
		}
	})

	describe.each(SCALE_PRESET_IDS)("in %s", (presetId) => {
		const scale = SCALE_PRESETS[presetId]

		it("bend each flyby's path by the true angle", () => {
			for (const { trajectory, encounter, label } of flybys) {
				const geometry = encounter.flyby!
				const { hyperbola, table } = geometry
				const frame = frameAt(geometry.anchorJD, scale)
				const prepared = flybyScaleOf(trajectory, encounter, frame)!
				// the legs' directions as far out as the drawing keeps them true
				const F = Math.acosh(
					((0.9 * SKEW_FROM * table.coreKm) / hyperbola.a + 1) / hyperbola.e,
				)
				const direction = (
					jd: number,
					h: number,
					drawnScale: ScaleSettings,
				) => {
					const [before, after] = [jd - h, jd + h].map((t) => {
						const f = frameAt(t, drawnScale)
						const state = craftStateAt(trajectory, t, f, createCraftState())
						const p = encounter.planet * 3
						const own =
							drawnScale === trueScale ? state.trueKm : state.displayKm
						const centre =
							drawnScale === trueScale ? f.positionsKm : f.displayKm
						return [0, 1, 2].map((c) => own[c] - centre[p + c])
					})
					return [0, 1, 2].map((c) => after[c] - before[c])
				}
				const drawnBend = turnOf(
					direction(drawnTimeAt(geometry, prepared, -F), 1e-3, scale),
					direction(drawnTimeAt(geometry, prepared, F), 1e-3, scale),
				)
				const trueBend = turnOf(
					direction(trueTimeAt(hyperbola, -F), 1e-4, trueScale),
					direction(trueTimeAt(hyperbola, F), 1e-4, trueScale),
				)
				expect(
					Math.abs(drawnBend - trueBend) * (180 / Math.PI),
					label,
				).toBeLessThan(2)
			}
		})

		it("pass each planet closest at the true distance scaled like its moons, outside it and on the right side of its moons", () => {
			for (const { trajectory, encounter, label } of flybys) {
				const geometry = encounter.flyby!
				const planet = bodies[encounter.planet]
				const { times, frame, drawn, drawnPlanet, trueOffset } = sampled(
					trajectory,
					encounter,
					scale,
				)
				const prepared = flybyScaleOf(trajectory, encounter, frame)!
				const radius = frame.displayRadiiKm[encounter.planet]
				// the core scale is the moon curve's at the osculating periapsis
				const { rp } = geometry.hyperbola
				expect(prepared.periapsisKm / radius, label).toBeCloseTo(
					mapDistance(scale.moonDistance, rp / planet.radiusKm),
					9,
				)
				let closest = Infinity
				let nearest = Infinity
				let trueClosest = Infinity
				for (let k = 0; k < times.length; k++) {
					const o = k * 3
					const d = Math.hypot(
						drawn[o] - drawnPlanet[o],
						drawn[o + 1] - drawnPlanet[o + 1],
						drawn[o + 2] - drawnPlanet[o + 2],
					)
					const r = Math.hypot(
						trueOffset[o],
						trueOffset[o + 1],
						trueOffset[o + 2],
					)
					trueClosest = Math.min(trueClosest, r)
					const F = drawnAnomalyAt(geometry, prepared, times[k])
					const weight = nearWeight(geometry.hyperbola, prepared, F)
					// where the planet-centred drawing has it alone
					if (weight === 1) closest = Math.min(closest, d)
					// while it has any share: never inside the drawn planet
					if (weight > 0) nearest = Math.min(nearest, d)
					// at periapsis, the true path scaled
					if (times[k] === geometry.hyperbola.tp) {
						expect(d / r / prepared.k, label).toBeCloseTo(1, 6)
					}
				}
				expect(closest / (prepared.k * trueClosest), label).toBeGreaterThan(
					0.999,
				)
				expect(nearest / radius, label).toBeGreaterThan(1)
				for (const moon of bodies) {
					if (
						moon.parentId !== planet.id ||
						!moon.featured ||
						moon.orbit === null
					)
						continue
					const orbit =
						radius *
						mapDistance(
							scale.moonDistance,
							moon.orbit.semiMajorAxisKm / planet.radiusKm,
						)
					expect(closest < orbit, `${label}, ${moon.id}`).toBe(
						trueClosest < moon.orbit.semiMajorAxisKm,
					)
				}
			}
		})

		it.each(passages(["flyby", "departure"]).map((p) => p.label))(
			"turn %s smoothly",
			(label) => {
				const { trajectory, encounter } = passages(["flyby", "departure"]).find(
					(p) => p.label === label,
				)!
				const { worst, where } = sharpestTurn(trajectory, encounter, presetId)
				const limit =
					presetId === "poster"
						? (POSTER_SHARPEST[label] ?? SHARPEST)
						: SHARPEST
				expect(worst, where).toBeLessThan(limit)
			},
		)
	})
})
