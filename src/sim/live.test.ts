import { describe, expect, it } from "vitest"

import { LIVE_TOLERANCE_DAYS, isLive } from "./live"
import { dateToJD } from "./time"

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
