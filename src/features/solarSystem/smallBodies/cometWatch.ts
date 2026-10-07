/**
 * "Watch it pass the Sun" (#23): one click takes the class to a comet's next passage
 * with the tail still to grow, at a speed that shows the whole passage in about a minute
 * and a half, with the comet in the middle and the Sun in the frame.
 */
import type { Body } from "@/data"
import { propagate, type OrbitElements, type Vec3 } from "@/sim"
import {
	TAIL_ONSET_KM,
	nextPerihelionJD,
	previousPerihelionJD,
} from "@/sim/comet"
import { WARP_PRESETS, useSimStore } from "@/store/sim"

/** Real seconds the passage (tail on to tail off) should take on screen. */
export const WATCH_SECONDS = 90

export interface Passage {
	/** the comet crosses `TAIL_ONSET_KM` inbound: its coma starts to grow */
	startJD: number
	perihelionJD: number
	/** ...and outbound: the tail is gone */
	endJD: number
}

const at: Vec3 = { x: 0, y: 0, z: 0 }
const sunDistanceKm = (orbit: OrbitElements, jd: number): number => {
	propagate(orbit, jd, at)
	return Math.hypot(at.x, at.y, at.z)
}

/**
 * When a comet is inside `TAIL_ONSET_KM` around the perihelion at `perihelionJD`: the
 * crossings on either side, found by bisection (the distance grows monotonically away
 * from perihelion). A comet that never leaves that sphere is active all the time.
 */
export function passageAround(
	orbit: OrbitElements,
	perihelionJD: number,
): Passage {
	const half = orbit.periodDays / 2
	const cross = (direction: 1 | -1): number => {
		let inside = 0
		let outside = half
		if (
			sunDistanceKm(orbit, perihelionJD + direction * outside) < TAIL_ONSET_KM
		) {
			return perihelionJD + direction * half
		}
		for (let k = 0; k < 60; k++) {
			const mid = (inside + outside) / 2
			if (
				sunDistanceKm(orbit, perihelionJD + direction * mid) < TAIL_ONSET_KM
			) {
				inside = mid
			} else {
				outside = mid
			}
		}
		return perihelionJD + direction * outside
	}
	return { startJD: cross(-1), perihelionJD, endJD: cross(1) }
}

/** The last instant the time controls travel to (ui/timeTravel.ts `LAST_DAY`, 2999-12-31). */
export const LATEST_WATCH_JD = 2816787.5

/**
 * The passage to watch from `jd`: the one under way (the comet is inside the tail
 * sphere right now), else the next one; for a comet that returns only after
 * `latestJD` (Hale-Bopp, NEOWISE: thousands of years) the last one instead.
 */
export function passageToWatch(
	orbit: OrbitElements,
	jd: number,
	latestJD = LATEST_WATCH_JD,
): Passage {
	const current = passageAround(orbit, previousPerihelionJD(orbit, jd))
	if (jd < current.endJD) return current
	const next = passageAround(orbit, nextPerihelionJD(orbit, jd))
	return next.startJD <= latestJD ? next : current
}

/** The speed preset (seconds per second) closest, on a log scale, to showing `days` in `WATCH_SECONDS`. */
export function watchWarp(days: number): number {
	const wanted = (days * 86400) / WATCH_SECONDS
	let best = WARP_PRESETS[0]
	for (const preset of WARP_PRESETS) {
		if (
			Math.abs(Math.log(preset / wanted)) < Math.abs(Math.log(best / wanted))
		) {
			best = preset
		}
	}
	return best
}

/** The instant a watch starts at: now, when the passage is already under way, else its start. */
export const watchStartJD = (passage: Passage, jd: number): number =>
	jd >= passage.startJD && jd < passage.endJD ? jd : passage.startJD

/**
 * Starts watching `body` pass the Sun: selects and centres it, framing a sphere as wide
 * as its perihelion distance (so the Sun is in the picture), glides the clock to the
 * start of the passage and lets it run forward at `watchWarp`.
 */
export function watchComet(body: Pick<Body, "id" | "orbit">): void {
	const orbit = body.orbit
	if (orbit === null) return
	const state = useSimStore.getState()
	const passage = passageToWatch(orbit, state.simTimeJD)
	const start = watchStartJD(passage, state.simTimeJD)
	const q = orbit.semiMajorAxisKm * (1 - orbit.eccentricity)
	// choosing the comet is a step of the view history (#46)
	state.markStep()
	state.select(body.id)
	state.focus(body.id, { fit: { km: 1.2 * q, around: "sun" } })
	state.setTimeWarp(watchWarp(passage.endJD - passage.startJD))
	state.setPaused(false)
	if (start !== state.simTimeJD) state.travelTo(start)
}
