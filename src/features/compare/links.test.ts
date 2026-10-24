import { describe, expect, it } from "vitest"

import { dateToJD, isLive } from "@/sim"

import { compareSearchFor } from "./links"

const now = new Date("2026-09-25T12:00:00Z")
const nowJD = dateToJD(now)

describe("compareSearchFor", () => {
	it("opens the body with its first partner, at the present", () => {
		const clock = { simTimeJD: nowJD, timeWarp: 1, paused: false }
		expect(isLive(clock, now)).toBe(true)
		expect(compareSearchFor("jupiter", clock, now)).toEqual({
			bodies: "jupiter,earth",
			t: undefined,
		})
		expect(compareSearchFor("earth", clock, now).bodies).toBe("earth,sun")
	})

	it("takes the moment on screen along when it is not the present", () => {
		const past = { simTimeJD: nowJD - 3650.123456, timeWarp: 1, paused: false }
		expect(compareSearchFor("mars", past, now).t).toBe(
			Math.round(past.simTimeJD * 1e4) / 1e4,
		)
		const paused = { simTimeJD: nowJD, timeWarp: 1, paused: true }
		expect(compareSearchFor("mars", paused, now).t).toBeDefined()
		const fast = { simTimeJD: nowJD, timeWarp: 3600, paused: false }
		expect(isLive(fast, now)).toBe(false)
	})
})
