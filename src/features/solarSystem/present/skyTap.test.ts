import { afterEach, describe, expect, it } from "vitest"

import { useGestureHintStore } from "../sheet/gestureHint"
import {
	onSkyTap,
	skyTapAction,
	skyTapHides,
	tapRestores,
	type SkyTapContext,
} from "./skyTap"

/** A finger on a phone, the controls on screen, nothing else going on. */
const calm: SkyTapContext = {
	touch: true,
	pointer: "touch",
	hidden: false,
	opening: false,
	introHints: false,
	hunt: false,
	quickLook: false,
	dismissing: false,
	sheetRaised: false,
}

describe("a tap on the sky (#59)", () => {
	it("hides the controls on a touch screen, by finger or pen", () => {
		expect(skyTapHides(calm)).toBe(true)
		expect(skyTapHides({ ...calm, pointer: "pen" })).toBe(true)
	})

	it("never with a mouse, nor on a screen whose pointer is a mouse", () => {
		expect(skyTapHides({ ...calm, pointer: "mouse" })).toBe(false)
		// a touchscreen laptop: the finger on a screen the mouse drives
		expect(skyTapHides({ ...calm, touch: false })).toBe(false)
	})

	it("not while the opening plays or says how to move, nor over the hunt's clue or the quick look", () => {
		expect(skyTapHides({ ...calm, opening: true })).toBe(false)
		expect(skyTapHides({ ...calm, introHints: true })).toBe(false)
		expect(skyTapHides({ ...calm, hunt: true })).toBe(false)
		expect(skyTapHides({ ...calm, quickLook: true })).toBe(false)
	})

	it("not when the tap closes a menu, a popover or a hint, nor when already hidden", () => {
		expect(skyTapHides({ ...calm, dismissing: true })).toBe(false)
		expect(skyTapHides({ ...calm, hidden: true })).toBe(false)
	})
})

describe("the tap that brings the controls back", () => {
	const hidden = { ...calm, hidden: true }

	it("is any finger's tap while they are hidden", () => {
		expect(tapRestores(hidden)).toBe(true)
		expect(tapRestores(calm)).toBe(false)
	})

	it("leaves a mouse to pick bodies (a teacher presenting), and the opening its pause", () => {
		expect(tapRestores({ ...hidden, pointer: "mouse" })).toBe(false)
		expect(tapRestores({ ...hidden, touch: false })).toBe(false)
		expect(tapRestores({ ...hidden, opening: true })).toBe(false)
	})
})

describe("a tap on the sky with the phone's sheet raised (#60)", () => {
	const raised = { ...calm, sheetRaised: true }

	it("lowers the sheet first, by finger or mouse, and hides nothing", () => {
		expect(skyTapAction(raised)).toBe("lower")
		expect(skyTapAction({ ...raised, pointer: "mouse", touch: false })).toBe(
			"lower",
		)
		// over the hunt's clue too: lowering frees the sky to tap the answer
		expect(skyTapAction({ ...raised, hunt: true })).toBe("lower")
	})

	it("at small height, hides as before; a mouse does nothing", () => {
		expect(skyTapAction(calm)).toBe("hide")
		expect(skyTapAction({ ...calm, pointer: "mouse" })).toBe("none")
	})

	it("never when the tap closed a menu, while hidden or while the opening plays", () => {
		expect(skyTapAction({ ...raised, dismissing: true })).toBe("none")
		expect(skyTapAction({ ...raised, hidden: true })).toBe("none")
		expect(skyTapAction({ ...raised, opening: true })).toBe("none")
	})
})

describe("a tap on the sky while the gesture hint is up (#62)", () => {
	afterEach(() =>
		useGestureHintStore.setState(useGestureHintStore.getInitialState(), true),
	)

	it("takes the hint away and does nothing else", () => {
		useGestureHintStore.setState({ showing: true })
		expect(onSkyTap(new Event("click"))).toBe("none")
		expect(useGestureHintStore.getState().showing).toBe(false)
	})
})
