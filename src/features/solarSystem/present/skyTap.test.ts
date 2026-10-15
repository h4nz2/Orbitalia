import { describe, expect, it } from "vitest"

import { skyTapHides, tapRestores, type SkyTapContext } from "./skyTap"

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
