import { afterEach, describe, expect, it } from "vitest"

import { useSimStore } from "@/store/sim"

import { cycleFocus } from "../ui/focusCycle"
import {
	SWIPE_FOLLOW_PX,
	SWIPE_PX,
	followPx,
	swipeDirection,
	swipeToWorld,
} from "./swipe"

const store = () => useSimStore.getState()

afterEach(() => useSimStore.setState(useSimStore.getInitialState(), true))

describe("a sideways swipe on a world's card (#62)", () => {
	it("to the left is the next world, to the right the one before", () => {
		expect(swipeDirection(-SWIPE_PX, 0)).toBe(1)
		expect(swipeDirection(SWIPE_PX, 0)).toBe(-1)
		expect(swipeDirection(-140, 20)).toBe(1)
	})

	it("needs 48 px sideways, and half as much again as up or down", () => {
		expect(swipeDirection(-(SWIPE_PX - 1), 0)).toBeNull()
		expect(swipeDirection(-60, -40)).toBe(1)
		expect(swipeDirection(-60, -41)).toBeNull()
		expect(swipeDirection(30, 90)).toBeNull()
	})

	it("draws the card aside a little, never more than 72 px", () => {
		expect(followPx(0)).toBe(0)
		expect(followPx(-50)).toBeCloseTo(-20)
		expect(followPx(400)).toBe(SWIPE_FOLLOW_PX)
		expect(followPx(-400)).toBe(-SWIPE_FOLLOW_PX)
	})

	it("flies from Earth to Mars and to Venus, as the arrow keys do, one step of Back each", () => {
		store().setFocus("earth")
		const step = store().step
		expect(swipeToWorld(1)).toBe(true)
		expect(store().focusId).toBe("mars")
		expect(store().step).toBeGreaterThan(step)
		store().setFocus("earth")
		expect(swipeToWorld(-1)).toBe(true)
		expect(store().focusId).toBe("venus")
	})

	it("goes on from the world on the card, and keeps a planet's moons among themselves", () => {
		store().setFocus("io")
		swipeToWorld(1)
		expect(store().focusId).toBe(cycleFocus("io", 1))
		expect(store().focusId).not.toBe("io")
		expect(cycleFocus("io", 1)).not.toBe("saturn")
		// a card about a selected body (a world held still, #31) swipes on from it
		store().setFocus("earth")
		store().select("jupiter")
		swipeToWorld(1)
		expect(store().focusId).toBe("saturn")
	})
})
