/**
 * What the HUD says about a spacecraft and where it sends the camera (issue
 * #35). The HUD never reads the SimFrame (docs/ARCHITECTURE.md, "Rendering"):
 * it computes what it needs from the data at the throttled simulation time,
 * with true positions for every readout (distances, signal time) and the
 * active scale only for where the camera should go.
 */
import { bodies, bodyById, planets, type Body } from "@/data"
import { spacecraftById, type Spacecraft } from "@/data/spacecraft"
import {
	TRUE_SCALE,
	buildIndex,
	dateToJD,
	computeDisplayRadii,
	computePositions,
	degToRad,
	rootIndexOf,
	toUnits,
	type ScaleSettings,
} from "@/sim"
import { watchDirection, watchPlan } from "@/sim/follow"
import {
	craftPhase,
	craftStateAt,
	createCraftState,
	distanceKm,
	drawnPhaseAt,
	isoToJD,
	lightTimeSeconds,
	type CentreFrame,
	type CraftPhase,
	type CraftState,
} from "@/sim/spacecraft"
import { type CameraShot } from "@/store/navigation"
import { useSimStore } from "@/store/sim"
import { useSpacecraftStore } from "@/store/spacecraft"

import {
	CAMERA_FOV_DEG,
	CRAFT_FRAMING_DISTANCE,
	overviewRadius,
} from "../camera/framing"
import { prefersReducedMotion } from "../present/media"
import { pointOffsetKm } from "../camera/recentre"
import { createSimFrame } from "../scene/simFrame"
import { travelAndStop } from "../ui/timeTravel"
import { trajectoryOf } from "./trajectories"

const index = buildIndex(bodies)
const rootIndex = rootIndexOf(bodies)
const rootBody = bodies[rootIndex]
const earthIndex = index.get("earth") ?? rootIndex

export interface CraftFacts {
	phase: CraftPhase
	/** Position known (inside the data range). */
	available: boolean
	/** A date in the future (after the wall clock): the position is a prediction. */
	predicted: boolean
	sunDistanceKm: number
	earthDistanceKm: number
	/** One-way light time to Earth, s. */
	signalSeconds: number
	/** Speed relative to `anchorId`, km/s. */
	speedKmS: number
	/** The Sun, or the planet whose neighbourhood it is in. */
	anchorId: string
	/** The planet nearest to it (#57, while following), and how far, km. */
	nearestPlanetId: string
	nearestPlanetKm: number
}

/** A frame that only sizes the drawing under `scale` (all `drawnPhaseAt` reads), kept per scale. */
const sizing = new WeakMap<ScaleSettings, CentreFrame>()
const sizingFrame = (scale: ScaleSettings): CentreFrame => {
	let frame = sizing.get(scale)
	if (frame === undefined) {
		frame = {
			bodies,
			positionsKm: [],
			displayKm: [],
			displayRadiiKm: computeDisplayRadii(bodies, scale),
			scale,
		}
		sizing.set(scale, frame)
	}
	return frame
}

/**
 * Facts about `craft` at `jd`, from true positions; null while its trajectory
 * is not loaded. With `scale`, at the instant the drawing shows: near a
 * planet the craft is drawn in slow motion (#56), and the card (its speed
 * and distances, the nearest planet while following, #57) describes the
 * craft as it is on screen; at the closest approach the two agree.
 */
export function craftFacts(
	craft: Spacecraft,
	clockJD: number,
	scale?: ScaleSettings,
): CraftFacts | null {
	const trajectory = trajectoryOf(craft.id)
	if (trajectory === null) return null
	const jd =
		scale === undefined
			? clockJD
			: drawnPhaseAt(trajectory, clockJD, sizingFrame(scale))
	const positions = computePositions(bodies, jd, undefined, index)
	const state = craftStateAt(
		trajectory,
		jd,
		{
			bodies,
			positionsKm: positions,
			displayKm: positions,
			displayRadiiKm: bodies.map((body) => body.radiusKm),
			scale: TRUE_SCALE,
		},
		createCraftState(),
	)
	const at = (i: number) => positions.subarray(i * 3, i * 3 + 3)
	const { velocityKmS: v } = state
	let nearest = planets[0]
	let nearestKm = Infinity
	for (const planet of planets) {
		const km = distanceKm(state.trueKm, at(index.get(planet.id)!))
		if (km < nearestKm) {
			nearest = planet
			nearestKm = km
		}
	}
	return {
		phase: craftPhase(craft, clockJD),
		available: state.available,
		predicted: clockJD > dateToJD(new Date()) + 1,
		sunDistanceKm: distanceKm(state.trueKm, at(rootIndex)),
		earthDistanceKm: distanceKm(state.trueKm, at(earthIndex)),
		signalSeconds: lightTimeSeconds(state.trueKm, at(earthIndex)),
		speedKmS: Math.hypot(v[0], v[1], v[2]),
		anchorId: bodies[Math.max(0, state.anchorIndex)].id,
		nearestPlanetId: nearest.id,
		nearestPlanetKm: nearestKm,
	}
}

/** Where a view should centre to show `craft` at `jd` under `scale`, and how far out. */
export function craftView(
	craft: Spacecraft,
	jd: number,
	scale: ScaleSettings,
): {
	anchorId: string
	offsetKm: [number, number, number]
	distance: number
} | null {
	const trajectory = trajectoryOf(craft.id)
	if (trajectory === null) return null
	const frame = createSimFrame(bodies, jd, scale)
	const state: CraftState = craftStateAt(
		trajectory,
		jd,
		frame,
		createCraftState(),
	)
	if (!state.available) return null
	const anchor = Math.max(0, state.anchorIndex)
	const offset = pointOffsetKm(
		frame,
		anchor,
		state.displayKm,
		new Float64Array(3),
	)
	const a = anchor * 3
	const drawnKm = Math.hypot(
		state.displayKm[0] - frame.displayKm[a],
		state.displayKm[1] - frame.displayKm[a + 1],
		state.displayKm[2] - frame.displayKm[a + 2],
	)
	// keep the anchor (the Sun, the planet) on screen beside the craft
	const distance =
		anchor === rootIndex
			? drawnKm / (0.85 * overviewRadius(scale) * 1000)
			: toUnits(drawnKm) / (1.5 * frame.renderRadius(anchor))
	return {
		anchorId: bodies[anchor].id,
		offsetKm: [offset[0], offset[1], offset[2]],
		distance: Math.min(30, Math.max(anchor === rootIndex ? 0.04 : 1, distance)),
	}
}

/** Selects the craft and flies the view to where it is now: a step of the view history (#46). */
export function showCraft(id: string, scale: ScaleSettings): void {
	const craft = spacecraftById.get(id)
	if (craft === undefined) return
	useSimStore.getState().markStep()
	useSpacecraftStore.getState().selectCraft(id)
	const view = craftView(craft, useSimStore.getState().simTimeJD, scale)
	if (view === null) return
	useSimStore
		.getState()
		.goTo(
			{ kind: "point", anchorId: view.anchorId, offsetKm: view.offsetKm },
			{ shot: { distance: view.distance } },
		)
}

/** The planet to watch an event from: the target planet, or a moon's planet. */
const eventPlanet = (target: string | undefined): Body | null => {
	const body = target === undefined ? undefined : bodyById.get(target)
	if (body === undefined || body.parentId === null) return null
	if (body.kind === "moon") return bodyById.get(body.parentId) ?? null
	return body
}

/**
 * A milestone: time glides to it and stops, and the view goes to the planet
 * it happened at, or to where the craft was. The date is kept inside the
 * trajectory data, so the craft is on screen on arrival: the launch goes to
 * the first state (minutes after lift-off), Cassini's plunge to its last.
 * A step of the view history (#46).
 */
export function showEvent(
	craft: Spacecraft,
	event: { date: string; target?: string },
	scale: ScaleSettings,
): void {
	const trajectory = trajectoryOf(craft.id)
	const eventJD = isoToJD(event.date)
	const jd =
		trajectory === null
			? eventJD
			: Math.min(trajectory.toJD, Math.max(trajectory.fromJD, eventJD))
	useSimStore.getState().markStep()
	useSpacecraftStore.getState().selectCraft(craft.id)
	travelAndStop(jd)
	const planet = eventPlanet(event.target)
	const store = useSimStore.getState()
	if (planet !== null) {
		store.focus(planet.id)
		return
	}
	const view = craftView(craft, jd, scale)
	if (view !== null) {
		store.goTo(
			{ kind: "point", anchorId: view.anchorId, offsetKm: view.offsetKm },
			{ shot: { distance: view.distance } },
		)
	}
}

/**
 * How far out a camera starts following a craft (#57), in multiples of
 * `CRAFT_FRAMING_DISTANCE`: near a planet as "Show" frames it (the planet
 * beside it), between the planets closer than that (the Sun beyond the edge,
 * the path through the craft), and the neighbourhood it is in.
 */
function followFraming(
	craft: Spacecraft,
	jd: number,
	scale: ScaleSettings,
): { anchorId: string; distance: number } | null {
	const trajectory = trajectoryOf(craft.id)
	if (trajectory === null) return null
	const frame = createSimFrame(bodies, jd, scale)
	const state = craftStateAt(trajectory, jd, frame, createCraftState())
	if (!state.available) return null
	const anchor = Math.max(0, state.anchorIndex)
	const a = anchor * 3
	const drawnKm = Math.hypot(
		state.displayKm[0] - frame.displayKm[a],
		state.displayKm[1] - frame.displayKm[a + 1],
		state.displayKm[2] - frame.displayKm[a + 2],
	)
	const km =
		anchor === rootIndex
			? 0.5 * drawnKm
			: Math.max(4 * drawnKm, 6 * frame.displayRadiiKm[anchor])
	return {
		anchorId: bodies[anchor].id,
		distance: toUnits(km) / CRAFT_FRAMING_DISTANCE,
	}
}

/** True while the camera follows craft `id`. */
export const isFollowing = (id: string): boolean => {
	const { view } = useSimStore.getState()
	return view.kind === "craft" && view.id === id
}

/**
 * Rides along with a craft (#57): selects it and keeps it centred while time
 * runs, the camera's direction kept, its distance the craft's own. A step of
 * the view history (#46); already following it, nothing moves.
 */
export function followCraft(id: string, scale: ScaleSettings): void {
	const craft = spacecraftById.get(id)
	if (craft === undefined) return
	const sim = useSimStore.getState()
	sim.markStep()
	useSpacecraftStore.getState().selectCraft(id)
	if (isFollowing(id)) return
	const framing = followFraming(craft, sim.simTimeJD, scale)
	sim.goTo(
		{
			kind: "craft",
			id,
			anchorId: framing?.anchorId ?? rootBody.id,
		},
		{
			shot: { distance: framing?.distance ?? 1 },
			durationMs: prefersReducedMotion() ? 0 : undefined,
		},
	)
}

/** The body a milestone passes (a planet, a moon, Pluto), or -1 (JWST's L2). */
const targetIndex = (target: string | undefined): number =>
	target === undefined ? -1 : (index.get(target) ?? -1)

/**
 * Watch a passage (#57, a flyby or arrival milestone): time goes to shortly
 * before the closest approach and runs on at a speed at which the passage
 * takes about half a minute on screen (`watchPlan`, which allows for the
 * slow motion the drawing runs in near a planet, #56), and the camera
 * follows the craft, framed so what it passes is in view at the closest
 * approach, seen from above the plane of a planet's hyperbola. A step of the
 * view history (#46). False when there is nothing to watch (no data there).
 */
export function watchEvent(
	craft: Spacecraft,
	event: { date: string; target?: string },
	scale: ScaleSettings,
): boolean {
	const trajectory = trajectoryOf(craft.id)
	if (trajectory === null) return false
	const jd = isoToJD(event.date)
	const target = targetIndex(event.target)
	const plan = watchPlan(
		trajectory,
		{ jd, target },
		createSimFrame(bodies, jd, scale),
	)
	if (plan === null) return false
	// framed at the closest approach: what it passes, and the gap to it, in view
	const frame = createSimFrame(bodies, plan.closestJD, scale)
	const state = craftStateAt(
		trajectory,
		plan.closestJD,
		frame,
		createCraftState(),
	)
	const around = target >= 0 ? target : Math.max(0, state.anchorIndex)
	const o = around * 3
	const gapKm = Math.hypot(
		state.displayKm[0] - frame.displayKm[o],
		state.displayKm[1] - frame.displayKm[o + 1],
		state.displayKm[2] - frame.displayKm[o + 2],
	)
	const reachKm =
		around === rootIndex ? gapKm : gapKm + frame.displayRadiiKm[around]
	const km = (WATCH_MARGIN * reachKm) / Math.sin(degToRad(CAMERA_FOV_DEG) / 2)
	const shot: Partial<CameraShot> = {
		...(plan.encounter === null
			? {}
			: watchDirection(plan.encounter.flyby!.hyperbola)),
		distance: toUnits(km) / CRAFT_FRAMING_DISTANCE,
	}
	const instant = prefersReducedMotion()
	const sim = useSimStore.getState()
	sim.markStep()
	useSpacecraftStore.getState().selectCraft(craft.id)
	sim.setTimeWarp(plan.warp)
	sim.setPaused(false)
	if (instant) sim.setSimTime(plan.startJD)
	else sim.travelTo(plan.startJD)
	sim.goTo(
		{
			kind: "craft",
			id: craft.id,
			anchorId: bodies[Math.max(0, state.anchorIndex)].id,
		},
		{ shot, durationMs: instant ? 0 : undefined },
	)
	return true
}

/** The camera stands this much farther out than what frames the closest approach exactly. */
const WATCH_MARGIN = 1.2
