/**
 * The store's clock (issue #9): the time actions and the per-frame tick, driven
 * by a fake `performance.now()` so real time is under the test's control.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { bodies } from "@/data"
import {
	MAX_FRAME_GAP_MS,
	MS_PER_DAY,
	J2000_JD,
	buildIndex,
	computePositions,
	dateToJD,
	glideDurationMs,
	timelineJD,
} from "@/sim"

import { useSimStore } from "./sim"

const DAY = 86400
const YEAR = 31557600

let realMs = 0
const state = () => useSimStore.getState()

/** Advances fake real time by `ms` in frames of `frameMs`, ticking like SimClock. */
function run(ms: number, frameMs = 1000 / 60) {
	const end = realMs + ms
	while (realMs < end - 1e-9) {
		realMs = Math.min(end, realMs + frameMs)
		state().tick(realMs)
	}
}

beforeEach(() => {
	realMs = 10_000
	vi.spyOn(performance, "now").mockImplementation(() => realMs)
	useSimStore.setState(useSimStore.getInitialState(), true)
	state().setSimTime(J2000_JD)
})

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
	useSimStore.setState(useSimStore.getInitialState(), true)
})

describe("the store clock", () => {
	it("starts at the wall clock at 1x: the epoch is anchored to real time", () => {
		const initial = useSimStore.getInitialState()
		expect(Math.abs(initial.simTimeJD - dateToJD(new Date()))).toBeLessThan(
			1 / 24,
		)
		expect(initial.clock.anchorJD).toBe(initial.simTimeJD)
		expect(initial.clock.rate).toBe(1)
		expect(initial.lastTickMs).toBeNull()
	})

	it("runs at timeWarp simulated seconds per real second", () => {
		run(2000)
		const realTime = J2000_JD + 2000 / MS_PER_DAY
		expect(state().simTimeJD).toBeCloseTo(realTime, 12)
		state().setTimeWarp(DAY)
		run(1500)
		expect(state().simTimeJD).toBeCloseTo(realTime + 1.5, 6)
		state().setTimeWarp(YEAR)
		run(1000)
		expect(state().simTimeJD).toBeCloseTo(realTime + 1.5 + 365.25, 6)
	})

	it("changing the speed never moves anything", () => {
		state().setTimeWarp(DAY)
		run(700)
		for (const warp of [YEAR, -DAY, 60, 0, 3600, -YEAR]) {
			realMs += 5 // between frames
			const before = timelineJD(state().clock, realMs)
			state().setTimeWarp(warp)
			expect(state().simTimeJD).toBe(before)
			run(300)
		}
	})

	it("pause freezes every body at once, exactly where it is, and play resumes from there", () => {
		const index = buildIndex(bodies)
		state().setTimeWarp(YEAR)
		run(500)
		realMs += 7
		const at = timelineJD(state().clock, realMs)
		state().setPaused(true)
		expect(state().simTimeJD).toBe(at)
		const frozen = computePositions(bodies, state().simTimeJD, undefined, index)
		run(5000)
		expect(state().simTimeJD).toBe(at)
		expect(
			Array.from(computePositions(bodies, state().simTimeJD, undefined, index)),
		).toEqual(Array.from(frozen))

		state().togglePause()
		expect(state().paused).toBe(false)
		expect(state().simTimeJD).toBe(at)
		run(1000)
		expect(state().simTimeJD).toBeCloseTo(at + 365.25, 6)
		state().togglePause()
		expect(state().paused).toBe(true)
	})

	it("a negative warp runs the whole system backwards, and the speed survives a pause", () => {
		state().setTimeWarp(-DAY)
		run(3000)
		expect(state().simTimeJD).toBeCloseTo(J2000_JD - 3, 6)
		state().setPaused(true)
		expect(state().timeWarp).toBe(-DAY)
		expect(state().clock.rate).toBe(0)
		state().setPaused(false)
		expect(state().clock.rate).toBe(-DAY)
		run(1000)
		expect(state().simTimeJD).toBeCloseTo(J2000_JD - 4, 6)
	})

	it("the same simulation date twice gives bit-identical positions", () => {
		const index = buildIndex(bodies)
		const date = 2461307.8125
		state().setPaused(true)
		state().setSimTime(date)
		run(100)
		const first = computePositions(bodies, state().simTimeJD, undefined, index)

		state().setPaused(false)
		state().setTimeWarp(YEAR)
		run(1234)
		state().travelTo(J2000_JD)
		run(3000)
		state().setPaused(true)
		state().setSimTime(date)
		run(100)
		const second = computePositions(bodies, state().simTimeJD, undefined, index)
		expect(state().simTimeJD).toBe(date)
		for (let i = 0; i < first.length; i++) {
			expect(Object.is(second[i], first[i])).toBe(true)
		}
	})

	it("looks the same at 144 Hz and at 30 Hz", () => {
		state().setTimeWarp(DAY)
		const start = realMs
		run(4000, 1000 / 144)
		const fast = state().simTimeJD
		realMs = start
		state().setSimTime(J2000_JD)
		useSimStore.setState({ lastTickMs: null })
		run(4000, 1000 / 30)
		expect(state().simTimeJD).toBeCloseTo(fast, 9)
	})
})

describe("time travel", () => {
	it("glides to a date without a discontinuity and settles on it", () => {
		const target = J2000_JD + 9000
		const duration = glideDurationMs(9000)
		state().setPaused(true)
		state().travelTo(target)
		expect(state().clock.glide).not.toBeNull()
		expect(state().clock.anchorMs).toBe(realMs + duration)
		expect(state().simTimeJD).toBe(J2000_JD)

		let previous = state().simTimeJD
		let largestStep = 0
		const end = realMs + duration + 100
		while (realMs < end) {
			run(1000 / 60)
			largestStep = Math.max(largestStep, state().simTimeJD - previous)
			expect(state().simTimeJD).toBeGreaterThanOrEqual(previous)
			previous = state().simTimeJD
		}
		expect(state().simTimeJD).toBe(target)
		expect(state().clock.glide).toBeNull()
		// no single frame carries more than a few percent of the trip
		expect(largestStep).toBeLessThan(9000 * 0.05)
		// still paused after landing
		run(1000)
		expect(state().simTimeJD).toBe(target)
	})

	it("runs on at the current speed after landing", () => {
		state().setTimeWarp(DAY)
		state().travelTo(J2000_JD - 100, 500)
		run(500)
		expect(state().simTimeJD).toBe(J2000_JD - 100)
		run(1000)
		expect(state().simTimeJD).toBeCloseTo(J2000_JD - 99, 6)
	})

	it("pausing during a glide lets it land and then holds", () => {
		state().setTimeWarp(DAY)
		state().travelTo(J2000_JD + 365, 1000)
		run(400)
		state().setPaused(true)
		run(2000)
		expect(state().simTimeJD).toBe(J2000_JD + 365)
	})

	it("Now glides to the present and stays live at 1x", () => {
		// the wall clock is pinned: a real Date ticking between the test's reading
		// and setNow's own would change the glide's length under a loaded machine
		vi.useFakeTimers({
			toFake: ["Date"],
			now: new Date("2026-09-24T12:00:00Z"),
		})
		const from = J2000_JD
		const nowJD = dateToJD(new Date())
		state().setNow()
		const duration = glideDurationMs(nowJD - from)
		expect(state().clock.glide?.durationMs).toBe(duration)
		run(duration / 2)
		expect(state().simTimeJD).toBeGreaterThan(from)
		expect(state().simTimeJD).toBeLessThan(nowJD)
		run(duration / 2 + 50)
		// lands on the wall clock as it will be on arrival, then runs on at 1x
		// (the fake real time does not move Date)
		const landed = state().simTimeJD
		expect(landed).toBeCloseTo(nowJD + (duration + 50) / MS_PER_DAY, 8)
		run(60_000, 1000)
		expect(state().simTimeJD).toBeCloseTo(landed + 60_000 / MS_PER_DAY, 9)
	})

	it("ignores non-finite targets", () => {
		state().travelTo(Number.NaN)
		state().travelTo(Number.POSITIVE_INFINITY)
		state().setSimTime(Number.NaN)
		expect(state().clock.glide).toBeNull()
		expect(state().simTimeJD).toBe(J2000_JD)
	})
})

describe("frame gaps", () => {
	it("resumes where it was after the page was hidden, at any speed but 1x", () => {
		state().setTimeWarp(YEAR)
		run(1000)
		const before = state().simTimeJD
		realMs += 10 * 60_000 // ten minutes in another tab: no frames
		state().tick(realMs)
		const skippedTo = before + (MAX_FRAME_GAP_MS * YEAR) / 1000 / DAY
		expect(state().simTimeJD).toBeCloseTo(skippedTo, 6)
	})

	it("keeps real time across a gap at 1x", () => {
		run(1000)
		const before = state().simTimeJD
		realMs += 10 * 60_000
		state().tick(realMs)
		expect(state().simTimeJD).toBeCloseTo(before + 600 / DAY, 9)
	})

	it("a live clock is back on the wall clock after the laptop slept (#69)", () => {
		const wall = new Date("2026-09-24T22:00:00Z").getTime()
		state().setSimTime(dateToJD(new Date(wall)))
		state().tick(realMs, wall)
		state().tick((realMs += 16), wall + 16)
		// performance.now() stood still through the night; the wall clock did not
		const morning = wall + 9 * 3600_000
		state().tick((realMs += 16), morning)
		expect(state().simTimeJD).toBeCloseTo(dateToJD(new Date(morning)), 8)
		expect(state().timeWarp).toBe(1)
		expect(state().paused).toBe(false)
		expect(state().step).toBe(0)
	})

	it("a paused clock stays where it was across the same night", () => {
		const wall = new Date("2026-09-24T22:00:00Z").getTime()
		state().setSimTime(dateToJD(new Date(wall)))
		state().setPaused(true)
		state().tick(realMs, wall)
		state().tick((realMs += 16), wall + 9 * 3600_000)
		expect(state().simTimeJD).toBe(dateToJD(new Date(wall)))
	})

	it("a jump made during a gap is kept", () => {
		state().setTimeWarp(DAY)
		run(100)
		realMs += 5000
		state().setSimTime(2460000)
		realMs += 5000
		state().tick(realMs)
		expect(state().simTimeJD).toBeGreaterThanOrEqual(2460000)
		expect(state().simTimeJD).toBeLessThanOrEqual(2460000 + 5)
	})
})
