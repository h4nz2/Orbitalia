/**
 * Whether the simulation clock shows the present (#69): running forwards at
 * real speed, on the wall clock. The one definition for everything that treats
 * "now" apart from a chosen moment: the solar system's address carries no `t`
 * while it holds (`store/urlSync.ts`), the comparison opens at the present
 * (`features/compare/links.ts`), and a sky event or the quick look goes back to
 * "now" rather than to the instant it began (`tours/player.ts` `currentScene`).
 *
 * Like the rest of src/sim it never reads a clock: the caller hands in the
 * wall clock.
 */
import { dateToJD } from "./time"

/**
 * A clock this close to the wall clock, running at 1x, shows the present: two
 * minutes, well above what a link's `t` rounds away (about 9 s) and what the
 * time bar's Now lands off by, well below any moment someone picks on purpose.
 */
export const LIVE_TOLERANCE_DAYS = 2 / 1440

/** The clock fields that decide it (the simulation store's). */
export interface LiveClock {
	simTimeJD: number
	timeWarp: number
	paused: boolean
}

/** Whether `clock` shows the present at the wall clock `now`: running at 1x, within `LIVE_TOLERANCE_DAYS` of it. */
export const isLive = (clock: LiveClock, now: Date): boolean =>
	!clock.paused &&
	clock.timeWarp === 1 &&
	Math.abs(clock.simTimeJD - dateToJD(now)) < LIVE_TOLERANCE_DAYS
