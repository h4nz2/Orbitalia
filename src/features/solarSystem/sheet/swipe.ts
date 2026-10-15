/**
 * Swiping between worlds (#62; docs/ARCHITECTURE.md, "Students first"): on a
 * phone held upright a sideways swipe on a world's card in the sheet flies to
 * the next world or the one before, as the arrow keys do (`ui/focusCycle.ts`):
 * the planets in order from the Sun, a planet's moons among themselves. A
 * swipe to the left is the next world, outwards, like a carousel. Pure but
 * for `swipeToWorld`, which acts on the store.
 */
import { allMoonsShown, useSimStore } from "@/store/sim"

import { cardBodyId } from "../ui/cardBody"
import { cycleFocus } from "../ui/focusCycle"

/** A swipe flies on once the finger has gone at least this far sideways, px. */
export const SWIPE_PX = 48

/** ...and this many times as far sideways as up or down; anything more upright is the sheet's. */
export const SWIPE_RATIO = 1.5

/** The card follows the finger by this share of its travel... */
export const SWIPE_FOLLOW = 0.4

/** ...at most this far, px. */
export const SWIPE_FOLLOW_PX = 72

/**
 * Where a finger that moved `dx`, `dy` px (screen axes) and lifted goes: 1 to
 * the next world (it moved left), -1 to the one before (right), null for no
 * swipe (too short, or too upright).
 */
export function swipeDirection(dx: number, dy: number): 1 | -1 | null {
	if (Math.abs(dx) < SWIPE_PX) return null
	if (Math.abs(dx) < SWIPE_RATIO * Math.abs(dy)) return null
	return dx < 0 ? 1 : -1
}

/** How far the card is drawn aside while the finger is `dx` px sideways. */
export const followPx = (dx: number): number =>
	Math.max(-SWIPE_FOLLOW_PX, Math.min(SWIPE_FOLLOW_PX, dx * SWIPE_FOLLOW))

/**
 * Flies to the next world (`direction` 1) or the one before (-1) from the
 * world on the card. Choosing it is a step of the view history (#46,
 * `setFocus` marks it), so Back returns. Returns whether it went anywhere.
 */
export function swipeToWorld(direction: 1 | -1): boolean {
	const state = useSimStore.getState()
	const from = cardBodyId(state) ?? state.focusId
	const next = cycleFocus(from, direction, allMoonsShown(state))
	if (next === from) return false
	state.setFocus(next)
	return true
}
