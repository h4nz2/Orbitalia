/**
 * What the HUD says about a spacecraft and where it sends the camera (issue
 * #35). The HUD never reads the SimFrame (docs/ARCHITECTURE.md, "Rendering"):
 * it computes what it needs from the data at the throttled simulation time,
 * with true positions for every readout (distances, signal time) and the
 * active scale only for where the camera should go.
 */
import { bodies, bodyById, type Body } from "@/data"
import { spacecraftById, type Spacecraft } from "@/data/spacecraft"
import {
	TRUE_SCALE,
	buildIndex,
	dateToJD,
	computePositions,
	rootIndexOf,
	toUnits,
	type ScaleSettings,
} from "@/sim"
import {
	craftPhase,
	craftStateAt,
	createCraftState,
	distanceKm,
	isoToJD,
	lightTimeSeconds,
	type CraftPhase,
	type CraftState,
} from "@/sim/spacecraft"
import { useSimStore } from "@/store/sim"
import { useSpacecraftStore } from "@/store/spacecraft"

import { overviewRadius } from "../camera/framing"
import { pointOffsetKm } from "../camera/recentre"
import { createSimFrame } from "../scene/simFrame"
import { travelAndStop } from "../ui/timeTravel"
import { trajectoryOf } from "./trajectories"

const index = buildIndex(bodies)
const rootIndex = rootIndexOf(bodies)
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
}

/** Facts about `craft` at `jd`, from true positions; null while its trajectory is not loaded. */
export function craftFacts(craft: Spacecraft, jd: number): CraftFacts | null {
	const trajectory = trajectoryOf(craft.id)
	if (trajectory === null) return null
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
	return {
		phase: craftPhase(craft, jd),
		available: state.available,
		predicted: jd > dateToJD(new Date()) + 1,
		sunDistanceKm: distanceKm(state.trueKm, at(rootIndex)),
		earthDistanceKm: distanceKm(state.trueKm, at(earthIndex)),
		signalSeconds: lightTimeSeconds(state.trueKm, at(earthIndex)),
		speedKmS: Math.hypot(v[0], v[1], v[2]),
		anchorId: bodies[Math.max(0, state.anchorIndex)].id,
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
