/**
 * Riding along with a spacecraft (#57), against the real trajectories: a
 * camera following a craft is centred on its drawn position every frame, so
 * that position must move smoothly wherever the drawing hands over (between
 * a planet's neighbourhood and open space, #56) in every preset; and Watch
 * shows every flyby and arrival in the data in 20 to 40 seconds, in every
 * preset, however slowly the drawing runs near the planet.
 */
import { describe, expect, it } from "vitest"

import {
	SCALE_PRESETS,
	SCALE_PRESET_IDS,
	buildIndex,
	computeDisplayPositions,
	computeDisplayRadii,
	computePositions,
	type ScaleSettings,
} from "@/sim"
import { drawnTimeAt } from "@/sim/flyby"
import {
	WATCHED_EVENT_KINDS,
	WATCH_MAX_SECONDS,
	WATCH_MIN_SECONDS,
	watchPlan,
} from "@/sim/follow"
import {
	craftStateAt,
	createCentresAt,
	createCraftState,
	decodeTrajectory,
	drawnPhaseAt,
	flybyScaleOf,
	isoToJD,
	type CentreFrame,
	type CraftTrajectory,
} from "@/sim/spacecraft"

import { bodies } from "."
import { SpacecraftFile, TrajectoriesFile } from "./spacecraftSchema"
import catalogueJson from "./spacecraft.json"
import trajectoriesJson from "./spacecraftTrajectories.json"

const catalogue = SpacecraftFile.parse(catalogueJson)
const trajectories = TrajectoriesFile.parse(trajectoriesJson)
const index = buildIndex(bodies)
const decoded = new Map<string, CraftTrajectory>(
	catalogue.craft.map((craft) => [
		craft.id,
		decodeTrajectory(craft, trajectories[craft.id], bodies, index),
	]),
)

/** Bodies at `jd` under `scale`, as the scene's SimFrame has them. */
function frameAt(jd: number, scale: ScaleSettings) {
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

/**
 * The point a following camera is centred on, at any time: the craft's
 * drawn position with the planets where they are then (the SimFrame's
 * Sun-centred drawing, without computing every body).
 */
function followedPoint(trajectory: CraftTrajectory, frame: CentreFrame) {
	const centres = createCentresAt(trajectory.root)
	const state = createCraftState()
	return (jd: number): Float64Array | null => {
		centres.jd = jd
		craftStateAt(trajectory, jd, frame, state, centres.lookup)
		return state.available ? state.displayKm.slice() : null
	}
}

const speedOf = (
	at: (jd: number) => Float64Array | null,
	from: number,
	to: number,
): number => {
	const a = at(from)
	const b = at(to)
	if (a === null || b === null) return Number.NaN
	return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / (to - from)
}

describe("following a craft (#57)", () => {
	describe.each(SCALE_PRESET_IDS)("in %s", (presetId) => {
		const scale = SCALE_PRESETS[presetId]

		it("moves the followed point without a jolt where the drawing hands over", () => {
			for (const craft of catalogue.craft) {
				const trajectory = decoded.get(craft.id)!
				const frame = frameAt(trajectory.fromJD, scale)
				const at = followedPoint(trajectory, frame)
				// every hand-over: segment edges (Sun to planet), a passage's window
				// and where its planet-centred drawing gives way to the Sun-centred
				// map (#56); not an orbit insertion, where the slowed passage
				// switches to real time by design (docs/ARCHITECTURE.md, "Spacecraft")
				const edges = [
					...[...trajectory.helio, ...trajectory.planetary].flatMap((s) => [
						s.from,
						s.to,
					]),
					...trajectory.encounters.flatMap((e) => {
						const prepared = flybyScaleOf(trajectory, e, frame)
						const insertion =
							e.kind === "arrival" && e.hyperTo < e.to ? [] : [e.hyperTo]
						return [
							e.from,
							e.to,
							e.hyperFrom,
							...insertion,
							...(prepared === null || prepared.identity ? [] : prepared.farJD),
						]
					}),
				]
				for (const edge of edges) {
					for (const dt of [1 / 1440, 1 / 24]) {
						if (
							edge - 3 * dt <= trajectory.fromJD ||
							edge + 3 * dt >= trajectory.toJD
						) {
							continue
						}
						const across = speedOf(at, edge - dt, edge + dt)
						const before = speedOf(at, edge - 3 * dt, edge - dt)
						const after = speedOf(at, edge + dt, edge + 3 * dt)
						const label = `${craft.id} @${edge.toFixed(3)}, step ${dt}`
						expect(across, label).toBeLessThan(
							1.5 * Math.max(before, after) + 1,
						)
						expect(across, label).toBeGreaterThan(
							Math.min(before, after) / 1.5 - 1,
						)
					}
				}
			}
		})

		it("speeds up and slows down gradually through each passage's hand-over", () => {
			for (const craft of catalogue.craft) {
				const trajectory = decoded.get(craft.id)!
				const frame = frameAt(trajectory.fromJD, scale)
				const at = followedPoint(trajectory, frame)
				for (const encounter of trajectory.encounters) {
					const geometry = encounter.flyby
					const prepared = flybyScaleOf(trajectory, encounter, frame)
					if (geometry === null || prepared === null || prepared.identity) {
						continue
					}
					const { a, e } = geometry.hyperbola
					for (const side of [0, 1] as const) {
						// the hand-over band: from where it starts to where it ends
						const sign = side === 0 ? -1 : 1
						const F = (km: number) =>
							sign * Math.acosh(Math.max(1, (km / a + 1) / e))
						const ends = [
							drawnTimeAt(geometry, prepared, F(prepared.nearKm[side])),
							prepared.farJD[side],
						].sort((x, y) => x - y)
						const span = ends[1] - ends[0]
						const from = Math.max(encounter.hyperFrom, ends[0] - 0.1 * span)
						const to = Math.min(encounter.hyperTo, ends[1] + 0.1 * span)
						if (!(to > from)) continue
						const steps = Math.min(4000, Math.max(600, Math.ceil(to - from)))
						const dt = (to - from) / steps
						let previous = Number.NaN
						let worst = 1
						let where = ""
						for (let k = 0; k < steps; k++) {
							const speed = speedOf(at, from + k * dt, from + (k + 1) * dt)
							if (previous > 0 && speed > 0) {
								const change =
									Math.max(speed, previous) / Math.min(speed, previous)
								if (change > worst) {
									worst = change
									where = `${(from + k * dt).toFixed(2)}`
								}
							}
							previous = speed
						}
						expect(
							worst,
							`${craft.id} at ${bodies[encounter.planet].id}, ${side === 0 ? "in" : "out"} @${where}`,
						).toBeLessThan(1.25)
					}
				}
			}
		})
	})
})

/** Every milestone a passage can be watched at, with its craft. */
const watched = catalogue.craft.flatMap((craft) =>
	craft.events
		.filter((event) => WATCHED_EVENT_KINDS.includes(event.kind))
		.map((event) => ({
			craft,
			event,
			label: `${craft.id} ${event.kind} ${event.target ?? ""} ${event.date}`,
		})),
)

describe("watching a passage (#57)", () => {
	it("is offered for every flyby and arrival in the data", () => {
		expect(watched.length).toBeGreaterThanOrEqual(30)
	})

	describe.each(SCALE_PRESET_IDS)("in %s", (presetId) => {
		const scale = SCALE_PRESETS[presetId]

		it.each(watched.map((w) => w.label))(
			"shows %s in 20 to 40 s, closest approach on the way",
			(label) => {
				const { craft, event } = watched.find((w) => w.label === label)!
				const trajectory = decoded.get(craft.id)!
				const jd = isoToJD(event.date)
				const frame = frameAt(jd, scale)
				const plan = watchPlan(
					trajectory,
					{ jd, target: index.get(event.target ?? "") ?? -1 },
					frame,
				)!
				expect(plan).not.toBeNull()
				expect(plan.seconds).toBeGreaterThanOrEqual(WATCH_MIN_SECONDS)
				expect(plan.seconds).toBeLessThanOrEqual(WATCH_MAX_SECONDS)
				expect(plan.startJD).toBeLessThan(plan.closestJD)
				expect(plan.closestJD).toBeLessThanOrEqual(plan.endJD)
				// the craft is there when the watch begins
				const state = craftStateAt(
					trajectory,
					plan.startJD,
					frameAt(plan.startJD, scale),
					createCraftState(),
				)
				expect(state.available).toBe(true)
				// what the drawing shows (#56's slow motion near the planet): the
				// closest approach at the plan's clock time, and the passage for as
				// long as the plan says, stepping the clock at its speed
				expect(
					Math.abs(
						drawnPhaseAt(trajectory, plan.closestJD, frame) - plan.trueJD,
					) * 1440,
				).toBeLessThan(1)
				const from = Math.max(trajectory.fromJD, plan.trueJD - plan.halfDays)
				const to = Math.min(trajectory.toJD, plan.trueJD + plan.halfDays)
				const step = 0.05
				let shown = 0
				for (let s = -10; s < WATCH_MAX_SECONDS + 20; s += step) {
					const clock = plan.startJD + (s * plan.warp) / 86400
					const phase = drawnPhaseAt(trajectory, clock, frame)
					if (phase >= from && phase <= to) shown += step
				}
				expect(shown).toBeGreaterThanOrEqual(WATCH_MIN_SECONDS)
				expect(shown).toBeLessThanOrEqual(WATCH_MAX_SECONDS)
				expect(Math.abs(shown - plan.seconds)).toBeLessThan(0.5)
			},
		)
	})
})
