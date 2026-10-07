/**
 * The spacecraft's per-frame state below the Canvas (issue #35,
 * docs/ARCHITECTURE.md, "Spacecraft"): one `CraftFrame` per Canvas, created
 * beside the SimFrame and updated right after it (SpacecraftScene's useFrame at
 * `CRAFT_FRAME_PRIORITY`), read by the markers, paths, labels and picking.
 * Like the SimFrame it never changes identity and never causes a re-render.
 */
import { spacecraft as catalogue, type Spacecraft } from "@/data/spacecraft"
import {
	craftPhase,
	craftStateAt,
	createCraftState,
	isInSpace,
	type CraftPhase,
	type CraftState,
	type CraftTrajectory,
	type TruePointMapper,
} from "@/sim/spacecraft"

import { rootIndexOf } from "@/sim"
import { craftLengthScale } from "@/sim/follow"

import type { CraftLocator } from "../camera/director"
import { mapTruePointKm } from "../light/lightFront"
import type { SimFrame } from "../scene/simFrame"
import { trajectoryOf } from "./trajectories"

/** After SimClock (-1) has moved the bodies, before the camera director (-0.5). */
export const CRAFT_FRAME_PRIORITY = -0.9

export interface CraftFrame {
	readonly craft: readonly Spacecraft[]
	/** Per craft; null until the trajectory data has arrived (./trajectories.ts). */
	readonly trajectories: (CraftTrajectory | null)[]
	/** Per craft, at the frame's time. */
	readonly states: readonly CraftState[]
	readonly phases: CraftPhase[]
	/** 1 when the craft is in space at the frame's time and its position is known. */
	readonly present: Uint8Array
	/** Julian Date of the last update. */
	jd: number
	/** The SimFrame's scaleVersion of the last update (paths re-derive when it moves on). */
	scaleVersion: number
	/** Places a true point like a body there would be drawn, anchored frames (#31) included. */
	readonly map: TruePointMapper
}

export function createCraftFrame(
	frame: SimFrame,
	craft: readonly Spacecraft[] = catalogue,
): CraftFrame {
	const root = rootIndexOf(frame.bodies)
	const craftFrame: CraftFrame = {
		craft,
		trajectories: craft.map((entry) => trajectoryOf(entry.id)),
		states: craft.map(() => createCraftState()),
		phases: craft.map(() => "planned" as CraftPhase),
		present: new Uint8Array(craft.length),
		jd: Number.NaN,
		scaleVersion: -1,
		map: (anchor, x, y, z, out) =>
			mapTruePointKm(frame, root, anchor, x, y, z, out),
	}
	updateCraftFrame(craftFrame, frame)
	return craftFrame
}

/** Every craft at the SimFrame's time and scale. */
export function updateCraftFrame(
	craftFrame: CraftFrame,
	frame: SimFrame,
): void {
	const { jd } = frame
	for (let k = 0; k < craftFrame.craft.length; k++) {
		const phase = craftPhase(craftFrame.craft[k], jd)
		craftFrame.phases[k] = phase
		const trajectory = (craftFrame.trajectories[k] ??= trajectoryOf(
			craftFrame.craft[k].id,
		))
		if (trajectory === null) {
			craftFrame.states[k].available = false
			craftFrame.present[k] = 0
			continue
		}
		const state = craftStateAt(
			trajectory,
			jd,
			frame,
			craftFrame.states[k],
			undefined,
			craftFrame.map,
		)
		craftFrame.present[k] = isInSpace(phase) && state.available ? 1 : 0
	}
	craftFrame.jd = jd
	craftFrame.scaleVersion = frame.scaleVersion
}

/** Index of a craft by id, or -1. */
export const craftIndexOf = (
	craftFrame: CraftFrame,
	id: string | null,
): number =>
	id === null ? -1 : craftFrame.craft.findIndex((craft) => craft.id === id)

/**
 * The craft frame as the camera director reads it (#57): where a craft is
 * drawn now, the body whose neighbourhood it is in, and the drawing's local
 * scale round it.
 */
export function createCraftLocator(
	craftFrame: CraftFrame,
	frame: SimFrame,
): CraftLocator {
	const root = rootIndexOf(frame.bodies)
	const distance = (state: CraftState, body: number) => {
		const o = body * 3
		return Math.hypot(
			state.trueKm[0] - frame.positionsKm[o],
			state.trueKm[1] - frame.positionsKm[o + 1],
			state.trueKm[2] - frame.positionsKm[o + 2],
		)
	}
	return {
		locate: (id, out) => {
			const k = craftIndexOf(craftFrame, id)
			if (k < 0 || craftFrame.present[k] !== 1) return -1
			const state = craftFrame.states[k]
			out.set(state.displayKm)
			return Math.max(0, state.anchorIndex)
		},
		lengthScale: (id) => {
			const k = craftIndexOf(craftFrame, id)
			if (k < 0 || craftFrame.present[k] !== 1) return Number.NaN
			const state = craftFrame.states[k]
			const planet = state.drawnPlanet
			return craftLengthScale(
				frame.scale,
				frame.bodies[root],
				distance(state, root),
				planet < 0 ? null : frame.bodies[planet],
				planet < 0 ? 0 : distance(state, planet),
				state.drawnWeight,
			)
		},
	}
}
