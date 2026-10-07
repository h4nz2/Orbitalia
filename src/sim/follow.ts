/**
 * Riding along with a spacecraft (issue #57, docs/ARCHITECTURE.md,
 * "Spacecraft", "Follow and Watch"). Pure: no React, no three.js.
 *
 * - **Watch** (`watchPlan`): how to show one passage of a craft (a flyby, an
 *   arrival) in about half a minute. Near a planet the drawing runs in slow
 *   motion (#56, ./flyby.ts: time near the planet runs slower for the
 *   drawing by its local stretch), so a speed picked from the true times
 *   would race through the passage at true scale and take hours in Poster.
 *   The plan finds the clock times at which the drawing shows the passage
 *   (`clockTimeOf`, the inverse of `drawnPhaseAt`) and picks the speed from
 *   those.
 * - **The local scale** (`craftLengthScale`): how many drawn km one true km
 *   near the craft is drawn as. A camera following the craft holds its
 *   distance while time runs; on a scale change it keeps the distance in
 *   proportion to this, so what is round the craft keeps its size on screen.
 */
import type { Body } from "@/data"
import type { SpacecraftEventKind } from "@/data/spacecraftSchema"

import { drawnTimeAt, hyperbolicAnomaly, type Hyperbola } from "./flyby"
import { propagate, radToDeg, type Vec3 } from "./kepler"
import {
	childDistanceCurve,
	displayDistanceKm,
	displayRadiusKm,
	type ScaleSettings,
} from "./scale"
import {
	craftStateAt,
	createCraftState,
	encounterAt,
	flybyScaleOf,
	type CentreFrame,
	type CraftEncounter,
	type CraftTrajectory,
	type TrajectoryBody,
} from "./spacecraft"
import { SECONDS_PER_DAY } from "./units"

/** The milestones a passage can be watched at: flybys and arrivals. */
export const WATCHED_EVENT_KINDS: readonly SpacecraftEventKind[] = [
	"flyby",
	"orbitInsertion",
	"arrival",
]

/** Whether a milestone of this kind can be watched. */
export const isWatchedKind = (kind: string): boolean =>
	(WATCHED_EVENT_KINDS as readonly string[]).includes(kind)

/** A passage watched takes about this long on screen, seconds ... */
export const WATCH_SECONDS = 30
/** ... and always between these. */
export const WATCH_MIN_SECONDS = 20
export const WATCH_MAX_SECONDS = 40

/**
 * A passage is the stretch of a craft's path within this many closest
 * approaches of what it passes: it comes into view, swings by and leaves.
 */
export const WATCH_REACH = 4

/** Without a closest approach to measure (L2), a passage spans this many days either side of the event. */
export const WATCH_FALLBACK_HALF_DAYS = 1
/** A passage spans at least and at most this many true days either side of its closest approach. */
const WATCH_MIN_HALF_DAYS = 10 / 1440
const WATCH_MAX_HALF_DAYS = 30
/** A target's closest approach is searched this many days either side of the event's date. */
const SEARCH_DAYS = 2

/**
 * Speeds a passage is watched at (simulated seconds per real second), never
 * more than 1.5 times apart, so one of them lands within 20 % of
 * `WATCH_SECONDS`: from a minute per second up, whole minutes, hours, days,
 * weeks and months per second, which the time bar names like its presets
 * ("90 min/s", "36 h/s", "3 weeks/s"); below, plain factors ("45x").
 */
export const WATCH_WARPS: readonly number[] = (() => {
	const minute = 60
	const hour = 3600
	const day = 86400
	const week = 7 * day
	const month = 2629800
	return Object.freeze(
		[
			...[10, 15, 20, 30, 45, 90],
			...[1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30, 45].map((n) => n * minute),
			...[1, 1.5, 2, 3, 4, 6, 8, 12, 18].map((n) => n * hour),
			...[1, 1.5, 2, 3, 4, 5, 6, 10].map((n) => n * day),
			...[1, 2, 3, 6].map((n) => n * week),
			...[1, 2, 3, 4, 6, 8, 12].map((n) => n * month),
		].sort((a, b) => a - b),
	)
})()

/** The watch speed that shows `clockDays` of clock time closest to `WATCH_SECONDS` (in log). */
export function watchWarp(clockDays: number): number {
	const ideal = (clockDays * SECONDS_PER_DAY) / WATCH_SECONDS
	let best = WATCH_WARPS[0]
	for (const warp of WATCH_WARPS) {
		if (Math.abs(Math.log(warp / ideal)) < Math.abs(Math.log(best / ideal))) {
			best = warp
		}
	}
	return best
}

/**
 * The clock time (JD) at which the drawn craft shows the true instant `jd`
 * (#56): within a passage drawn in slow motion, the drawn time of the
 * hyperbola's anomaly there (the inverse of `drawnPhaseAt`); elsewhere `jd`.
 */
export function clockTimeOf(
	trajectory: CraftTrajectory,
	jd: number,
	frame: CentreFrame,
): number {
	const encounter = encounterAt(trajectory, jd)
	const geometry = encounter?.flyby ?? null
	if (encounter === null || geometry === null) return jd
	const prepared = flybyScaleOf(trajectory, encounter, frame)!
	if (prepared.identity) return jd
	const { e, n, tp } = geometry.hyperbola
	const F = hyperbolicAnomaly(e, (jd - tp) * SECONDS_PER_DAY * n)
	const clock = drawnTimeAt(geometry, prepared, F)
	return clock >= encounter.hyperFrom && clock <= encounter.hyperTo ? clock : jd
}

/** A milestone to watch: its instant (JD) and what it passes (a body index, -1 for none). */
export interface WatchEvent {
	readonly jd: number
	readonly target: number
}

export interface WatchPlan {
	/** The true instant of the closest approach (JD) and the true days either side of it the passage spans. */
	readonly trueJD: number
	readonly halfDays: number
	/** The clock times (JD) at which the drawing shows the passage's start, its closest approach and its end. */
	readonly startJD: number
	readonly closestJD: number
	readonly endJD: number
	/** The speed (simulated seconds per real second), and how long the passage then takes on screen (s). */
	readonly warp: number
	readonly seconds: number
	/** The planet passage this is (its hyperbola gives the view's direction), or null. */
	readonly encounter: CraftEncounter | null
}

/** The planet passage of `trajectory` past body `target` around `jd`, if it is drawn as a hyperbola. */
function passageOf(
	trajectory: CraftTrajectory,
	target: number,
	jd: number,
): CraftEncounter | null {
	let best: CraftEncounter | null = null
	for (const encounter of trajectory.encounters) {
		if (encounter.planet !== target || encounter.flyby === null) continue
		if (encounter.kind !== "flyby" && encounter.kind !== "arrival") continue
		const tp = encounter.flyby.hyperbola.tp
		if (
			best === null ||
			Math.abs(tp - jd) < Math.abs(best.flyby!.hyperbola.tp - jd)
		) {
			best = encounter
		}
	}
	// the milestone's date and the passage's periapsis are hours apart at most
	return best !== null && Math.abs(best.flyby!.hyperbola.tp - jd) < 5
		? best
		: null
}

/** A frame with the bodies' ids, so a moon's planet can be found. */
export type WatchFrame = CentreFrame & {
	readonly bodies: readonly Pick<
		Body,
		"id" | "radiusKm" | "parentId" | "orbit"
	>[]
}

const parentCache = new WeakMap<object, readonly number[]>()

/** Each body's parent index (-1 for the root), once per bodies array. */
function parentsOf(
	bodies: readonly Pick<Body, "id" | "parentId">[],
): readonly number[] {
	let parents = parentCache.get(bodies)
	if (parents === undefined) {
		const index = new Map(bodies.map((body, i) => [body.id, i]))
		parents = bodies.map((body) =>
			body.parentId === null ? -1 : (index.get(body.parentId) ?? -1),
		)
		parentCache.set(bodies, parents)
	}
	return parents
}

const scratch: Vec3 = { x: 0, y: 0, z: 0 }

/** Body `i`'s true position (km, scene axes, the root at the origin) at `jd`, into `out`. */
function bodyTrueKm(
	bodies: readonly TrajectoryBody[],
	parents: readonly number[],
	i: number,
	jd: number,
	out: Float64Array,
): void {
	out.fill(0)
	for (let b = i; b >= 0 && parents[b] >= 0; b = parents[b]) {
		const orbit = bodies[b].orbit
		if (orbit == null) return
		propagate(orbit, jd, scratch)
		out[0] += scratch.x
		out[1] += scratch.y
		out[2] += scratch.z
	}
}

/**
 * The closest approach of a craft to body `target` within `SEARCH_DAYS` of
 * `jd`, from the true positions: its instant, distance (km) and the craft's
 * speed relative to the body there (km/s). Null without data.
 */
function closestApproachTo(
	trajectory: CraftTrajectory,
	frame: CentreFrame,
	parents: readonly number[],
	target: number,
	jd: number,
): { jd: number; km: number; speed: number } | null {
	const state = createCraftState()
	const body = new Float64Array(3)
	const distanceAt = (t: number): number => {
		craftStateAt(trajectory, t, frame, state)
		if (!state.available) return Infinity
		bodyTrueKm(frame.bodies, parents, target, t, body)
		const root = trajectory.root * 3
		return Math.hypot(
			state.trueKm[0] - frame.positionsKm[root] - body[0],
			state.trueKm[1] - frame.positionsKm[root + 1] - body[1],
			state.trueKm[2] - frame.positionsKm[root + 2] - body[2],
		)
	}
	const step = 10 / 1440
	let best = jd
	let km = Infinity
	for (let t = jd - SEARCH_DAYS; t <= jd + SEARCH_DAYS; t += step) {
		const d = distanceAt(t)
		if (d < km) {
			km = d
			best = t
		}
	}
	if (!Number.isFinite(km)) return null
	// golden-section refinement within one step either side
	let lo = best - step
	let hi = best + step
	for (let i = 0; i < 40; i++) {
		const a = hi - (hi - lo) * 0.618
		const b = lo + (hi - lo) * 0.618
		if (distanceAt(a) < distanceAt(b)) hi = b
		else lo = a
	}
	best = (lo + hi) / 2
	km = distanceAt(best)
	// the speed relative to the body, a minute either side
	const before = new Float64Array(3)
	const after = new Float64Array(3)
	const relativeAt = (t: number, out: Float64Array) => {
		craftStateAt(trajectory, t, frame, state)
		bodyTrueKm(frame.bodies, parents, target, t, body)
		for (let c = 0; c < 3; c++) out[c] = state.trueKm[c] - body[c]
	}
	relativeAt(best - 60 / SECONDS_PER_DAY, before)
	relativeAt(best + 60 / SECONDS_PER_DAY, after)
	const speed =
		Math.hypot(
			after[0] - before[0],
			after[1] - before[1],
			after[2] - before[2],
		) / 120
	return { jd: best, km, speed }
}

/**
 * How to watch one passage of a craft (#57): from shortly before its closest
 * approach to shortly after, at a speed at which it takes about
 * `WATCH_SECONDS` on screen. The passage is the stretch within `WATCH_REACH`
 * closest approaches of what it passes: for a planet drawn round the craft's
 * hyperbola (#56) the true hyperbola's, for any other body (a moon, Pluto)
 * the closest approach measured from the true positions, and a fixed span
 * for a milestone with nothing to pass (JWST at L2). `frame` gives the
 * scale (the drawing's pace depends on it); the plan's clock times are those
 * at which the drawing shows the passage, so the speed is right in every
 * preset. Null without trajectory data at the event.
 */
export function watchPlan(
	trajectory: CraftTrajectory,
	event: WatchEvent,
	frame: WatchFrame,
): WatchPlan | null {
	const parents = parentsOf(frame.bodies)
	let trueJD = event.jd
	let halfDays = WATCH_FALLBACK_HALF_DAYS
	const encounter =
		event.target >= 0 ? passageOf(trajectory, event.target, event.jd) : null
	if (encounter !== null) {
		const { a, e, n, rp, tp } = encounter.flyby!.hyperbola
		trueJD = Math.min(encounter.to, Math.max(encounter.from, tp))
		const F = Math.acosh((WATCH_REACH * rp) / a / e + 1 / e)
		halfDays = (e * Math.sinh(F) - F) / n / SECONDS_PER_DAY
	} else if (event.target >= 0) {
		const closest = closestApproachTo(
			trajectory,
			frame,
			parents,
			event.target,
			event.jd,
		)
		if (closest !== null && closest.speed > 0) {
			trueJD = closest.jd
			const km = Math.max(closest.km, 2 * frame.bodies[event.target].radiusKm!)
			halfDays = (WATCH_REACH * km) / closest.speed / SECONDS_PER_DAY
		}
	}
	halfDays = Math.min(
		WATCH_MAX_HALF_DAYS,
		Math.max(WATCH_MIN_HALF_DAYS, halfDays),
	)
	const from = Math.max(trajectory.fromJD, trueJD - halfDays)
	const to = Math.min(trajectory.toJD, trueJD + halfDays)
	if (!(to > from)) return null
	trueJD = Math.min(to, Math.max(from, trueJD))
	const startJD = clockTimeOf(trajectory, from, frame)
	const closestJD = clockTimeOf(trajectory, trueJD, frame)
	const endJD = clockTimeOf(trajectory, to, frame)
	if (!(endJD > startJD)) return null
	const warp = watchWarp(endJD - startJD)
	return {
		trueJD,
		halfDays,
		startJD,
		closestJD,
		endJD,
		warp,
		seconds: ((endJD - startJD) * SECONDS_PER_DAY) / warp,
		encounter,
	}
}

/**
 * The direction to watch a planet passage from (#57), camera-controls angles
 * (azimuth about the ecliptic pole from scene +Z, elevation above the
 * ecliptic, degrees). A passage in or near the plane of the planets (within
 * `WATCH_FLAT_DEG`, nearly all of them) is seen from `WATCH_ELEVATION_DEG`
 * above it, turned so the planet is to the right of the craft at the
 * closest approach: the whole turn shows, and the planet sweeps past on the
 * side away from the card. A steeper one (Voyager 2 over Neptune's pole) is
 * seen from above its own plane, tilted `WATCH_TILT_DEG` towards the planet.
 */
export const WATCH_FLAT_DEG = 30
export const WATCH_ELEVATION_DEG = 65
export const WATCH_TILT_DEG = 25

export function watchDirection(hyperbola: Pick<Hyperbola, "h" | "p">): {
	azimuthDeg: number
	elevationDeg: number
} {
	const { h, p } = hyperbola
	const up = h[1] >= 0 ? 1 : -1
	if (up * h[1] >= Math.cos((WATCH_FLAT_DEG * Math.PI) / 180)) {
		// the screen's right, (cos az, 0, -sin az), towards the planet (-p)
		return {
			azimuthDeg: radToDeg(Math.atan2(p[2], -p[0])),
			elevationDeg: WATCH_ELEVATION_DEG,
		}
	}
	const tilt = (WATCH_TILT_DEG * Math.PI) / 180
	const d = [0, 1, 2].map(
		(k) => up * h[k] * Math.cos(tilt) - p[k] * Math.sin(tilt),
	)
	const length = Math.hypot(d[0], d[1], d[2])
	return {
		azimuthDeg: radToDeg(Math.atan2(d[0], d[2])),
		elevationDeg: radToDeg(Math.asin(Math.max(-1, Math.min(1, d[1] / length)))),
	}
}

/**
 * How many drawn km one true km near a craft is drawn as under `scale`
 * (#57): the moon curve's ratio at its true distance from the planet whose
 * drawing places it, blended (in the log, by that drawing's weight) with the
 * Sun-centred map's at its true distance from the Sun. A camera following
 * the craft scales its distance by the change of this on a scale change.
 */
export function craftLengthScale(
	scale: ScaleSettings,
	sun: Pick<TrajectoryBody, "radiusKm">,
	sunDistanceKm: number,
	planet: Pick<TrajectoryBody, "radiusKm"> | null,
	planetDistanceKm: number,
	planetWeight: number,
): number {
	const sunKm = sun.radiusKm!
	const ratio = (km: number, drawn: number) =>
		km > 0 && Number.isFinite(drawn / km) && drawn > 0 ? drawn / km : 1
	const around = ratio(
		sunDistanceKm,
		displayDistanceKm(
			sunDistanceKm,
			sunKm,
			sunKm,
			childDistanceCurve(scale, true),
		),
	)
	const w = planet === null ? 0 : Math.min(1, Math.max(0, planetWeight))
	if (!(w > 0)) return around
	const radiusKm = planet!.radiusKm!
	const near = ratio(
		planetDistanceKm,
		displayDistanceKm(
			planetDistanceKm,
			radiusKm,
			displayRadiusKm(radiusKm, sunKm, scale.bodySize),
			childDistanceCurve(scale, false),
		),
	)
	return Math.exp(w * Math.log(near) + (1 - w) * Math.log(around))
}
