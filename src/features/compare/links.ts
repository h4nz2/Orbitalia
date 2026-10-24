/**
 * The way into the comparison from the solar system (#24): the card's
 * "Compare with…" opens `/compare` with the focused body and its first
 * partner (`defaultPartner`), measured at the moment on screen. Pure.
 */
import { isLive, type LiveClock } from "@/sim"

import type { CompareSearch } from "./search"
import { completeBodies, formatBodies } from "./selection"

/**
 * The search of the comparison for `bodyId`. The simulation's moment goes
 * along (`t`, 4 decimals as in the solar system's links) unless it is the
 * present (`isLive`, src/sim/live.ts), so distances are the ones of the date
 * on screen.
 */
export function compareSearchFor(
	bodyId: string,
	clock: LiveClock,
	now: Date = new Date(),
): CompareSearch {
	return {
		bodies: formatBodies(completeBodies([bodyId])),
		t: isLive(clock, now) ? undefined : Math.round(clock.simTimeJD * 1e4) / 1e4,
	}
}
