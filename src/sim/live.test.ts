import { describe, expect, it } from "vitest"

import { createTimeline, timelineJD } from "./clock"
import {
	LIVE_RESUME_GAP_MS,
	LIVE_TOLERANCE_DAYS,
	isLive,
	resumeLive,
} from "./live"
import { MS_PER_DAY, dateToJD } from "./time"

const now = new Date("2025-03-20T09:30:00Z")
const nowJD = dateToJD(now)
const clock = { simTimeJD: nowJD, timeWarp: 1, paused: false }

describe("isLive (#69)", () => {
	it("is the present: running at 1x within two minutes of the wall clock", () => {
		expect(LIVE_TOLERANCE_DAYS * 1440).toBe(2)
		expect(isLive(clock, now)).toBe(true)
		expect(isLive({ ...clock, simTimeJD: nowJD - 1.9 / 1440 }, now)).toBe(true)
		expect(isLive({ ...clock, simTimeJD: nowJD + 1.9 / 1440 }, now)).toBe(true)
	})

	it("is not: paused, another speed (backwards included) or a moment away", () => {
		expect(isLive({ ...clock, paused: true }, now)).toBe(false)
		expect(isLive({ ...clock, timeWarp: 2 }, now)).toBe(false)
		expect(isLive({ ...clock, timeWarp: -1 }, now)).toBe(false)
		expect(isLive({ ...clock, timeWarp: 86400 }, now)).toBe(false)
		expect(isLive({ ...clock, simTimeJD: nowJD - 2.1 / 1440 }, now)).toBe(false)
		expect(isLive({ ...clock, simTimeJD: nowJD + 365 }, now)).toBe(false)
	})
})

describe("resumeLive (#69)", () => {
	// the frame before the laptop went to sleep, on the wall clock `now`, at
	// performance.now() 5000; after a night it wakes at performance.now() 5100
	// (it stood still), the wall clock eight hours on
	const realMs = 5000
	const night = 8 * 3600_000
	const woken = now.getTime() + night
	const timeline = createTimeline(nowJD, realMs, 1)
	const previous = { clock, wallMs: now.getTime() }

	it("puts a clock that was live back on the wall clock after the gap, keeping 1x", () => {
		const resumed = resumeLive(timeline, previous, realMs + 100, woken)
		expect(timelineJD(resumed, realMs + 100)).toBeCloseTo(
			dateToJD(new Date(woken)),
			9,
		)
		expect(resumed.rate).toBe(1)
		expect(resumed.glide).toBeNull()
		// without it the clock would lag by the night, no longer "now"
		const lagging = timelineJD(timeline, realMs + 100)
		expect(isLive({ ...clock, simTimeJD: lagging }, new Date(woken))).toBe(
			false,
		)
	})

	it("leaves an ordinary frame, or a gap up to two seconds, alone", () => {
		expect(LIVE_RESUME_GAP_MS).toBe(2000)
		const gap = now.getTime() + LIVE_RESUME_GAP_MS
		expect(
			resumeLive(timeline, previous, realMs + 16, now.getTime() + 16),
		).toBe(timeline)
		expect(resumeLive(timeline, previous, realMs + 2000, gap)).toBe(timeline)
	})

	it("leaves a chosen moment where it was: paused, fast or another date", () => {
		for (const chosen of [
			{ ...clock, paused: true },
			{ ...clock, timeWarp: 86400 },
			{ ...clock, simTimeJD: nowJD - 3 / 1440 },
		]) {
			const paused = createTimeline(chosen.simTimeJD, realMs, 0)
			expect(
				resumeLive(
					paused,
					{ clock: chosen, wallMs: now.getTime() },
					5100,
					woken,
				),
			).toBe(paused)
		}
	})

	it("judges the earlier frame by the wall clock of that frame, not of now", () => {
		// eight hours behind the wall clock on waking, but live when it went to sleep
		const asleep = { clock, wallMs: woken - night }
		const resumed = resumeLive(timeline, asleep, realMs, woken)
		expect(resumed.anchorJD).toBeCloseTo(nowJD + night / MS_PER_DAY, 9)
	})
})
