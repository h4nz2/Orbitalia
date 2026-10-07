/**
 * The Easy hints that show rather than tell (#52): the first lights up the
 * part of the sky the answer is in, the second makes the answer itself pulse,
 * then comes "Show me". The overlay element lives in the HUD
 * (`HuntSpot.tsx`) and `HuntSpotTracker.tsx` places it over the answer every
 * frame, straight on the DOM, like Earth's pulse after the opening (#30).
 * Module state because the page has exactly one scene.
 */
import type { RingPlacement } from "../scene/highlight"

/** The area of the sky, or the answer pulsing. */
export type SpotKind = "area" | "pulse"

export interface SpotTarget {
	bodyId: string
	kind: SpotKind
	/** Turns the area's offset from the answer (the clue's id, hashed). */
	seed: number
}

export const huntSpot: {
	element: HTMLElement | null
	target: SpotTarget | null
} = { element: null, target: null }

/** What the Easy hints shown so far light up: nothing, the area, then the answer. */
export const spotKindFor = (hints: number): SpotKind | null =>
	hints <= 0 ? null : hints === 1 ? "area" : "pulse"

/** The area's radius, as a share of the screen's shorter side. */
export const AREA_SHARE = 0.16
/** How far the area's centre sits from the answer, as a share of its radius. */
export const AREA_OFFSET = 0.35

/** A stable number for a clue id (FNV-1a), to turn the area's offset. */
export function spotSeed(id: string): number {
	let hash = 0x811c9dc5
	for (let i = 0; i < id.length; i++) {
		hash ^= id.charCodeAt(i)
		hash = Math.imul(hash, 0x01000193)
	}
	return hash >>> 0
}

/**
 * The first hint's circle around the answer at `ring`: big enough to hold a
 * part of the sky (`AREA_SHARE` of a `width` x `height` screen, more for a big
 * disc), the answer well inside but off its centre, so the circle says
 * "around here" and the pulse that follows still says "this one".
 */
export function areaPlacement(
	ring: RingPlacement,
	seed: number,
	width: number,
	height: number,
): RingPlacement {
	const radius = Math.max(
		AREA_SHARE * Math.min(width, height),
		ring.ringPx / (1 - AREA_OFFSET - 0.1),
	)
	const angle = ((seed % 360) * Math.PI) / 180
	const offset = AREA_OFFSET * radius
	return {
		x: ring.x + Math.cos(angle) * offset,
		y: ring.y + Math.sin(angle) * offset,
		discPx: ring.discPx,
		ringPx: radius,
	}
}
