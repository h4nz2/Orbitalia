/**
 * Clicks while a body is held still (#31, on top of #16's click actions): a
 * click on another body selects it without leaving the frame, and a click on
 * empty space never ends the lesson.
 */
import { describe, expect, it } from "vitest"

import { OVERVIEW } from "@/store/navigation"

import { bodyClickAction, emptyClickAction } from "../scene/picking"

const held = {
	view: { kind: "body" as const, id: "earth" },
	selectedId: "mars",
	frameId: "earth",
	sequence: null,
}

describe("clicks in an anchored frame", () => {
	it("select another body instead of flying to it", () => {
		expect(bodyClickAction(held, "venus")).toBe("select")
		expect(bodyClickAction(held, "mars")).toBe("none")
		// the body held still keeps #16's behaviour
		expect(bodyClickAction({ ...held, selectedId: null }, "earth")).toBe(
			"focus",
		)
		expect(bodyClickAction(held, "earth")).toBe("focus")
	})

	it("keep the frame on a click into empty space", () => {
		expect(emptyClickAction(held, false)).toBe("deselect")
		expect(emptyClickAction({ ...held, selectedId: "earth" }, false)).toBe(
			"none",
		)
		expect(emptyClickAction({ ...held, selectedId: null }, false)).toBe("none")
	})

	it("leave the Sun-centred frame as #16 made it", () => {
		const free = { ...held, frameId: "sun" }
		expect(bodyClickAction(free, "venus")).toBe("focus")
		// and a click on empty space never leaves the view there either (#47)
		expect(emptyClickAction(free, false)).toBe("deselect")
		expect(emptyClickAction({ ...free, view: OVERVIEW }, false)).toBe(
			"deselect",
		)
	})
})
