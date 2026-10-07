import { describe, expect, it } from "vitest"

import {
	FOCUS_CLICK_MS,
	TAP_MAX_TRAVEL_PX,
	createPressTracker,
	isFocusPress,
	isTap,
	isTapEvent,
	pointerKindOf,
	type PointerKind,
	type PressInput,
} from "./tap"

describe("tap versus drag", () => {
	it("allows a finger more wobble than a mouse", () => {
		expect(isTap(4, "mouse")).toBe(true)
		expect(isTap(5, "mouse")).toBe(false)
		expect(isTap(10, "touch")).toBe(true)
		expect(isTap(TAP_MAX_TRAVEL_PX.touch + 1, "touch")).toBe(false)
		expect(TAP_MAX_TRAVEL_PX.pen).toBeGreaterThan(TAP_MAX_TRAVEL_PX.mouse)
	})

	it("reads the pointer type of the click, falling back to the mouse", () => {
		expect(pointerKindOf({ pointerType: "touch" } as unknown as Event)).toBe(
			"touch",
		)
		expect(pointerKindOf({} as Event)).toBe("mouse")
	})

	it("judges R3F click events by their travel", () => {
		const click = (delta: number, pointerType: string) => ({
			delta,
			nativeEvent: { pointerType } as unknown as Event,
		})
		expect(isTapEvent(click(0, "mouse"))).toBe(true)
		expect(isTapEvent(click(8, "mouse"))).toBe(false)
		expect(isTapEvent(click(8, "touch"))).toBe(true)
	})
})

/**
 * Plays pointer events into a fresh tracker, as the window listeners do: one
 * finger (or the mouse) at a time unless a second `id` goes down meanwhile.
 */
const finger = (
	tracker: ReturnType<typeof createPressTracker>,
	kind: PointerKind = "touch",
) => {
	let time = 10_000
	/** pointer ids held right now, the first one primary */
	const held: number[] = []
	const event = (id: number, x: number, y: number): PressInput => ({
		pointerId: id,
		pointerType: kind,
		isPrimary: held[0] === id,
		clientX: x,
		clientY: y,
		timeStamp: time,
	})
	return {
		down(x: number, y: number, id = 1, hasFocus = true) {
			if (kind !== "touch" || held.length === 0) held.length = 0
			held.push(id)
			tracker.down(event(id, x, y), hasFocus)
		},
		move(x: number, y: number, id = 1) {
			tracker.move(event(id, x, y))
		},
		up(id = 1) {
			held.splice(held.indexOf(id), 1)
		},
		wait(ms: number) {
			time += ms
		},
		get time() {
			return time
		},
	}
}

/** A seeded, repeatable wobble in [-1, 1]. */
const wobble = (seed: number) => Math.sin(seed * 12.9898) * Math.cos(seed * 4.1)

describe("small, slow, shaky fingers (#47)", () => {
	it("count a long press that shakes within the allowance as a tap", () => {
		const tracker = createPressTracker()
		const hand = finger(tracker)
		hand.down(200, 300)
		// two seconds of a child's finger trembling on the glass, 60 moves a second
		for (let i = 0; i < 120; i++) {
			hand.wait(16)
			// up to 10 px off its start, back and forth
			const r = 0.6 * TAP_MAX_TRAVEL_PX.touch
			hand.move(200 + r * wobble(i), 300 + r * wobble(i + 1000))
		}
		hand.up()
		expect(tracker.isTap(3, "touch")).toBe(true)
	})

	it("count a tiny press, a few pixels off its start, as a tap", () => {
		const tracker = createPressTracker()
		const hand = finger(tracker)
		hand.down(50, 50)
		hand.wait(80)
		hand.move(52, 49)
		hand.up()
		expect(tracker.isTap(2, "touch")).toBe(true)
	})

	it("never count a slow drag beyond the allowance, even back where it started", () => {
		const tracker = createPressTracker()
		const hand = finger(tracker)
		hand.down(400, 400)
		// one pixel every 100 ms, out to 20 px and back again
		for (let d = 1; d <= 20; d++) {
			hand.wait(100)
			hand.move(400 + d, 400)
		}
		for (let d = 19; d >= 0; d--) {
			hand.wait(100)
			hand.move(400 + d, 400)
		}
		hand.up()
		expect(tracker.isTap(0, "touch")).toBe(false)
	})

	it("hold the mouse to its smaller allowance", () => {
		const tracker = createPressTracker()
		const hand = finger(tracker, "mouse")
		hand.down(10, 10)
		hand.move(10 + TAP_MAX_TRAVEL_PX.mouse + 2, 10)
		hand.move(10, 10)
		expect(tracker.isTap(0, "mouse")).toBe(false)
		hand.down(10, 10)
		hand.move(12, 12)
		expect(tracker.isTap(2, "mouse")).toBe(true)
	})
})

describe("a pinch is not a tap (#47)", () => {
	const pinch = (firstUp: 1 | 2) => {
		const tracker = createPressTracker()
		const hand = finger(tracker)
		hand.down(300, 300, 1)
		hand.down(380, 300, 2)
		// a gentle pinch: neither finger travels beyond the allowance
		for (let i = 1; i <= 5; i++) {
			hand.wait(16)
			hand.move(300 - i, 300, 1)
			hand.move(380 + i, 300, 2)
		}
		hand.up(firstUp)
		hand.wait(120)
		hand.up(firstUp === 1 ? 2 : 1)
		return { tracker, hand }
	}

	it("when the second finger lifts first, and the first one follows", () => {
		expect(pinch(2).tracker.isTap(0, "touch")).toBe(false)
	})

	it("when the first finger lifts first, and the second one follows", () => {
		expect(pinch(1).tracker.isTap(0, "touch")).toBe(false)
	})

	it("but the next one-finger tap is a tap again", () => {
		const { tracker, hand } = pinch(2)
		hand.wait(400)
		hand.down(500, 200)
		hand.up()
		expect(tracker.isTap(0, "touch")).toBe(true)
	})

	it("nor is a tap made while another finger rests on the screen", () => {
		const tracker = createPressTracker()
		const hand = finger(tracker)
		hand.down(20, 700, 1)
		hand.wait(500)
		hand.down(300, 300, 2)
		hand.up(2)
		expect(tracker.isTap(0, "touch")).toBe(false)
	})
})

describe("the click that brings the window into focus (#47)", () => {
	it("does nothing when the page had no focus as it went down", () => {
		const tracker = createPressTracker()
		const hand = finger(tracker, "mouse")
		hand.down(100, 100, 1, false)
		expect(tracker.isTap(0, "mouse")).toBe(false)
		// the next click is an ordinary one
		hand.wait(800)
		hand.down(100, 100)
		expect(tracker.isTap(0, "mouse")).toBe(true)
	})

	it("does nothing when the window came into focus just before it", () => {
		const tracker = createPressTracker()
		const hand = finger(tracker, "mouse")
		tracker.focus(hand.time)
		hand.wait(30)
		hand.down(100, 100)
		expect(tracker.isTap(0, "mouse")).toBe(false)
	})

	it("does nothing when the window came into focus while it was held", () => {
		const tracker = createPressTracker()
		const hand = finger(tracker, "mouse")
		hand.down(100, 100)
		hand.wait(40)
		tracker.focus(hand.time)
		expect(tracker.isTap(0, "mouse")).toBe(false)
	})

	it("counts as usual once the window has had focus for a moment", () => {
		const tracker = createPressTracker()
		const hand = finger(tracker, "mouse")
		tracker.focus(hand.time)
		hand.wait(FOCUS_CLICK_MS + 1)
		hand.down(100, 100)
		expect(tracker.isTap(0, "mouse")).toBe(true)
	})

	it("is decided from the press and the last focus", () => {
		expect(isFocusPress({ at: 1000, hadFocus: false }, -Infinity)).toBe(true)
		expect(isFocusPress({ at: 1000, hadFocus: true }, -Infinity)).toBe(false)
		expect(isFocusPress({ at: 1000, hadFocus: true }, 990)).toBe(true)
		// the press's time stamp may even come before the focus it caused
		expect(isFocusPress({ at: 1000, hadFocus: true }, 1004)).toBe(true)
		expect(
			isFocusPress({ at: 1000, hadFocus: true }, 1000 - FOCUS_CLICK_MS),
		).toBe(false)
	})
})
