/**
 * Whether the simulation clock shows the present (#69): running forwards at
 * real speed, on the wall clock. The one definition for everything that treats
 * "now" apart from a chosen moment: the solar system's address carries no `t`
 * while it holds (`store/urlSync.ts`), the comparison opens at the present
 * (`features/compare/links.ts`), and a sky event or the quick look goes back to
 * "now" rather than to the instant it began (`tours/player.ts` `currentScene`).
 *
 * Like the rest of src/sim it never reads a clock: the caller hands in the
 * wall clock. `resumeLive` keeps a live clock live across a sleeping laptop.
 */
import { jumpTimeline, type SimTimeline } from "./clock"
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

/**
 * A gap this long on the wall clock between two frames (a laptop asleep, a
 * hidden tab) puts a live clock back on the wall clock (`resumeLive`). Frames
 * come many times a second while the page is drawn; two seconds is no stall.
 */
export const LIVE_RESUME_GAP_MS = 2000

/** The clock as it was at the previous frame, and the wall clock then (ms since 1970). */
export interface LiveFrame {
	clock: LiveClock
	wallMs: number
}

/**
 * The timeline after a gap between two frames, for a clock that showed the
 * present at the earlier one (#69). The timeline runs on `performance.now()`,
 * which on most systems stands still while the computer sleeps: a laptop
 * opened after the night would show last night, no longer "now", and the
 * address would take a `t` (a class QR code made then would lose the opening).
 * So after a gap of more than `LIVE_RESUME_GAP_MS` on the wall clock a clock
 * that was live jumps to the wall clock `wallMs`, keeping its speed. Nothing
 * else changes: no view step, no glide (nobody watched the gap). A clock that
 * was not live (paused, fast, a chosen moment) keeps its place.
 */
export function resumeLive(
	timeline: SimTimeline,
	previous: LiveFrame,
	realMs: number,
	wallMs: number,
): SimTimeline {
	if (!(wallMs - previous.wallMs > LIVE_RESUME_GAP_MS)) return timeline
	if (!isLive(previous.clock, new Date(previous.wallMs))) return timeline
	return jumpTimeline(timeline, realMs, dateToJD(new Date(wallMs)))
}
