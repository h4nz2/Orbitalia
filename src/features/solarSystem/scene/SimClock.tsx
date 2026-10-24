/**
 * The single writer of simulation time and positions (docs/ARCHITECTURE.md,
 * "Runtime contract"; the render origin belongs to the camera director).
 * Runs at useFrame priority -1, before every other
 * subscriber, and keeps R3F's automatic rendering on.
 *
 * Time is not accumulated here: `tick(performance.now(), Date.now())` samples
 * the store's clock (src/sim/clock.ts), a pure function of real time, so the
 * simulation shows the same instant whatever the frame rate. The wall clock is
 * there for a clock that shows the present: `performance.now()` stands still
 * while a laptop sleeps, and the first frame after it puts the clock back on
 * the wall clock (`resumeLive`, src/sim/live.ts, #69). React subscribers that follow
 * the clock use `useThrottledSimTime()` instead of a raw `simTimeJD` selector
 * so they re-render at most 10 times a second.
 */
import { useFrame } from "@react-three/fiber"

import { useSimStore } from "@/store/sim"

import { updateSimFrame, useSimFrame } from "./simFrame"

function SimClock() {
	const frame = useSimFrame()

	useFrame(() => {
		const store = useSimStore.getState()
		store.tick(performance.now(), Date.now())
		// positions only: the render origin is the camera's pivot, placed right
		// after this by the camera director (camera/director.ts, priority -0.5)
		updateSimFrame(frame, useSimStore.getState().simTimeJD)
	}, -1)

	return null
}

export default SimClock
