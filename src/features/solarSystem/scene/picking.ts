/**
 * What a click or tap on the scene means (docs/ARCHITECTURE.md, "Picking";
 * #16). One picker decides for every body, so a planet that is a fraction of
 * a pixel at true scale is as easy to hit as its label or its marker dot:
 *
 * - **On a disc**: the pointer ray passes through the drawn sphere of a body
 *   drawn at least as big as the target radius. The nearest disc wins.
 * - **Generous target**: a body drawn smaller than the pointer's target radius
 *   (`TARGET_RADIUS_PX`, larger for a finger than for a mouse) is hit anywhere
 *   within that radius of its centre, whatever its drawn size. Among those, a
 *   visible disc right under the pointer wins, then the Sun and the planets
 *   over moons, so from afar a planet's moons never steal its click. A small
 *   body in front of a big disc beats the disc; one behind it is hidden.
 * - **Empty space**: nothing within reach. A click there never moves the
 *   camera (#47); at most it clears the selection (`emptyClickAction`), and
 *   not even that on a near miss (`NEAR_MISS_FACTOR`).
 *
 * Pure: no React and no store, so all of it is unit-tested.
 */
import { PerspectiveCamera, Vector3 } from "three"

import type { Body } from "@/data"
import { degToRad } from "@/sim"
import {
	OVERVIEW_BODY_ID,
	type CameraShot,
	type NavigationSlice,
} from "@/store/navigation"

import type { SimFrame } from "./simFrame"
import type { PointerKind } from "./tap"

/**
 * Smallest radius around a body's centre that still hits it, px. A fingertip
 * covers 40 px or more of a phone screen; a mouse is precise, but a teacher
 * aiming at a projector from the side of the room is not.
 */
export const TARGET_RADIUS_PX: Readonly<Record<PointerKind, number>> = {
	mouse: 12,
	pen: 16,
	touch: 24,
}

/**
 * While an Easy clue of the scavenger hunt is on screen (#52), small bodies'
 * targets are this much larger: a child aiming at a dot is forgiven a miss.
 */
export const EASY_TARGET_FACTOR = 2

/**
 * A click within this multiple of the target radius of a body is a near miss,
 * not a click on empty space: aiming at a tiny moon and missing by a hair
 * must not close the card of what is selected.
 */
export const NEAR_MISS_FACTOR = 2.5

/**
 * A focused body the camera has been dollied this far away from (a multiple of
 * its default framing) is small again: a click on it flies back to the close-up.
 */
export const REFRAME_DISTANCE = 2.5

/**
 * A small body whose drawn disc is at least this wide (radius, px) and under
 * the pointer beats a planet nearby: it is visibly what was clicked.
 */
export const MIN_VISIBLE_DISC_PX = 2

/** Pixels per scene unit at unit distance from a perspective camera. */
export const pixelsPerUnitAtDistanceOne = (
	camera: PerspectiveCamera,
	heightPx: number,
): number => heightPx / (2 * Math.tan(degToRad(camera.fov / 2)))

export type PickFrame = Pick<
	SimFrame,
	"bodies" | "renderPosition" | "renderRadius"
>

export interface PickOptions {
	/** Pixels per scene unit at unit distance (`pixelsPerUnitAtDistanceOne`). */
	pxPerUnit: number
	/** The pointer's target radius, px (`TARGET_RADIUS_PX`). */
	targetRadiusPx: number
	/** Whether body `i` is on screen at all (`isBodyShown`). */
	isShown: (i: number) => boolean
	/**
	 * Whether body `i`, drawn `discPx` px in radius, gets the generous target.
	 * Default: every shown body.
	 */
	hasTarget?: (i: number, discPx: number) => boolean
}

export interface BodyPick {
	/** Index into `frame.bodies`. */
	index: number
	/** Along the ray to the hit, scene units (for sorting against other objects). */
	distance: number
	/** The pointer is on the body's drawn disc (not only within its target). */
	onDisc: boolean
}

const centre = new Vector3()

/**
 * The body a pointer ray (`origin`, unit `direction`, scene units relative to
 * the render origin) is aimed at, or null for empty space.
 */
export function pickBody(
	frame: PickFrame,
	origin: Vector3,
	direction: Vector3,
	options: PickOptions,
): BodyPick | null {
	const { pxPerUnit, targetRadiusPx, isShown, hasTarget } = options
	// bodies drawn at least as big as the target: their disc, nearest first
	let disc = -1
	let discEntry = Infinity
	// smaller bodies: on a visible disc first, then the Sun and planets, then
	// moons; the nearest edge breaks ties
	let target = -1
	let targetRank = -1
	let targetEdgePx = Infinity
	let targetAlong = Infinity
	let targetOnDisc = false
	for (let i = 0; i < frame.bodies.length; i++) {
		if (!isShown(i)) continue
		frame.renderPosition(i, centre).sub(origin)
		const along = centre.dot(direction)
		if (!(along > 0)) continue
		const perpSq = Math.max(0, centre.lengthSq() - along * along)
		const radius = frame.renderRadius(i)
		const discPx = (radius / along) * pxPerUnit
		if (discPx >= targetRadiusPx) {
			if (perpSq <= radius * radius) {
				const entry = along - Math.sqrt(radius * radius - perpSq)
				if (entry < discEntry) {
					disc = i
					discEntry = entry
				}
			}
			continue
		}
		const pointerPx = (Math.sqrt(perpSq) / along) * pxPerUnit
		if (pointerPx > targetRadiusPx) continue
		if (hasTarget !== undefined && !hasTarget(i, discPx)) continue
		const onDisc = pointerPx <= discPx
		const rank =
			onDisc && discPx >= MIN_VISIBLE_DISC_PX
				? 2
				: frame.bodies[i].kind !== "moon"
					? 1
					: 0
		const edgePx = Math.max(0, pointerPx - discPx)
		if (rank > targetRank || (rank === targetRank && edgePx < targetEdgePx)) {
			target = i
			targetRank = rank
			targetEdgePx = edgePx
			targetAlong = along
			targetOnDisc = onDisc
		}
	}
	if (target >= 0 && targetAlong <= discEntry) {
		return { index: target, distance: targetAlong, onDisc: targetOnDisc }
	}
	if (disc >= 0) return { index: disc, distance: discEntry, onDisc: true }
	return null
}

/**
 * Whether the ray passes within `reachPx` of any shown body's drawn edge: a
 * click there is a near miss, not a click on empty space.
 */
export function isNearAnyBody(
	frame: PickFrame,
	origin: Vector3,
	direction: Vector3,
	pxPerUnit: number,
	reachPx: number,
	isShown: (i: number) => boolean,
): boolean {
	for (let i = 0; i < frame.bodies.length; i++) {
		if (!isShown(i)) continue
		frame.renderPosition(i, centre).sub(origin)
		const along = centre.dot(direction)
		if (!(along > 0)) continue
		const perp = Math.sqrt(Math.max(0, centre.lengthSq() - along * along))
		const radius = frame.renderRadius(i)
		if (perp <= radius) return true
		if (((perp - radius) / along) * pxPerUnit <= reachPx) return true
	}
	return false
}

/**
 * Which bodies get the generous target besides being drawn: the Sun and the
 * planets always (they are what a class aims at, and their labels name them
 * even when they are sub-pixel); a moon only while its marker dot is drawn
 * (`isMoonDotShown`, the focus family) or its disc is visible. Otherwise a
 * click into apparently empty space could fly to an invisible moon.
 */
export const hasGenerousTarget = (
	body: Pick<Body, "kind">,
	discPx: number,
	moonDotShown: boolean,
): boolean => body.kind !== "moon" || moonDotShown || discPx >= 1

type ClickState = Pick<NavigationSlice, "view" | "selectedId"> & {
	/** The camera at rest; unknown means framed. */
	shot?: CameraShot | null
	/** The body the reference frame holds still (#31); absent or the Sun: Sun-centred. */
	frameId?: string
}

/** A body other than the Sun is held still (#31). */
const anchoredFrame = (frameId: string | undefined): boolean =>
	frameId !== undefined && frameId !== OVERVIEW_BODY_ID

export type BodyClickAction =
	/** select it and fly to it (`setFocus`) */
	| "focus"
	/** it is the focus but far away: fly back to the close-up */
	| "reframe"
	/** it is the focus and selected, and framed: nothing to do */
	| "none"
	/**
	 * another body while one is held still (#31): select it (its trail is
	 * highlighted, the frame's badge reads its motion) without leaving the
	 * frame; the picker or "Hold ... still" move the frame on purpose
	 */
	| "select"

/** What a click on body `id` does. */
export function bodyClickAction(
	state: ClickState,
	id: string,
): BodyClickAction {
	const { view, selectedId, shot } = state
	if (anchoredFrame(state.frameId) && id !== state.frameId) {
		return selectedId === id ? "none" : "select"
	}
	if (view.kind !== "body" || view.id !== id) return "focus"
	if (selectedId !== id) return "focus"
	if (shot != null && shot.distance > REFRAME_DISTANCE) return "reframe"
	return "none"
}

export type EmptyClickAction =
	/**
	 * the selection is the body in view (or nothing), a near miss, or a tour is
	 * running: a stray click never ends a lesson
	 */
	| "none"
	/** clear the selection: its card closes, or gives way to the focus's; the camera stays */
	| "deselect"

/**
 * What a click on empty space does: it never moves the camera (#47). Leaving
 * a body is always deliberate (the way out, Escape, or choosing another
 * body), so a stray click, a palm on a touchpad or a child's tap at most lets
 * go of a body selected besides the one in view, as it always did in the
 * overview and while a body is held still (#31). The focused body stays
 * selected: its card stays open (its × closes it) and the planet filling the
 * view never turns into a click target.
 */
export function emptyClickAction(
	state: Pick<NavigationSlice, "view" | "selectedId" | "sequence">,
	nearMiss: boolean,
): EmptyClickAction {
	if (nearMiss || state.sequence !== null || state.selectedId === null) {
		return "none"
	}
	const inView = state.view.kind === "body" ? state.view.id : null
	return state.selectedId === inView ? "none" : "deselect"
}
