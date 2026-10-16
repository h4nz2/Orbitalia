import { describe, expect, it } from "vitest"

import {
	CLOSE_SHARE,
	FLICK_PX_PER_MS,
	FOOT_MARGIN_PX,
	clearOfFoot,
	contentPx,
	distinctHeights,
	nextHeight,
	restingHeight,
	stepHeight,
	type ContentSizes,
} from "./heights"

/** A long list in the sheet: a header of 44 px, 900 px of content. */
const list: ContentSizes = {
	natural: 900,
	summary: 44,
	halfCap: 290,
	fullCap: 650,
}

/** The body card, which folds itself: as tall as it is laid out. */
const card: ContentSizes = { ...list, natural: 62, summary: Infinity }

const px = (sizes: ContentSizes) => ({
	small: contentPx("small", sizes),
	half: contentPx("half", sizes),
	full: contentPx("full", sizes),
})

describe("the sheet's heights (#60)", () => {
	it("gives the content its summary, half or full, never more than it has", () => {
		expect(px(list)).toEqual({ small: 44, half: 290, full: 650 })
		// the folded card is its own small form, and short content stops at its end
		expect(px(card)).toEqual({ small: 62, half: 62, full: 62 })
		expect(px({ ...list, natural: 200 })).toEqual({
			small: 44,
			half: 200,
			full: 200,
		})
	})

	it("counts heights that come out the same once", () => {
		expect(distinctHeights(px({ ...list, natural: 200 }))).toEqual([
			{ height: "small", px: 44 },
			{ height: "half", px: 200 },
		])
	})

	it("steps up with the handle, and from the top back to small", () => {
		const heights = px(list)
		expect(nextHeight("small", heights)).toBe("half")
		expect(nextHeight("half", heights)).toBe("full")
		expect(nextHeight("full", heights)).toBe("small")
		// no full of its own: from half back to small
		expect(nextHeight("half", px({ ...list, natural: 200 }))).toBe("small")
	})

	it("raises and lowers with the arrow keys, staying at the ends", () => {
		const heights = px(list)
		expect(stepHeight("small", 1, heights)).toBe("half")
		expect(stepHeight("full", 1, heights)).toBe("full")
		expect(stepHeight("half", -1, heights)).toBe("small")
		expect(stepHeight("small", -1, heights)).toBe("small")
	})

	it("comes to rest at the nearest height, or the next one after a flick", () => {
		const heights = px(list)
		expect(restingHeight(300, 0, heights, true)).toBe("half")
		expect(restingHeight(500, 0, heights, true)).toBe("full")
		// a flick up from just above half goes on to full, a flick down to small
		expect(restingHeight(320, FLICK_PX_PER_MS, heights, true)).toBe("full")
		expect(restingHeight(280, -FLICK_PX_PER_MS, heights, true)).toBe("small")
	})

	it("closes when pulled well below small, if what it shows may close", () => {
		const heights = px(list)
		const below = 44 * (1 - CLOSE_SHARE) - 1
		expect(restingHeight(below, 0, heights, true)).toBe("close")
		expect(restingHeight(below, 0, heights, false)).toBe("small")
		// a flick down from just below small closes too
		expect(restingHeight(40, -2 * FLICK_PX_PER_MS, heights, true)).toBe("close")
		expect(restingHeight(40, 0, heights, true)).toBe("small")
	})
})

describe("a sticky foot never rests across a control (#60)", () => {
	// a tour stop: its words, then autoplay and the link (215-259 in the content), then Back and Next
	const tools = { top: 215, bottom: 259 }
	const foot = 56

	it("leaves a height alone that cuts no control", () => {
		// all of it above the foot
		expect(clearOfFoot(330, foot, [tools], 0)).toBe(330)
		// the foot's top above the row: the row waits behind it, whole
		expect(clearOfFoot(260, foot, [tools], 0)).toBe(260)
	})

	it("lowers the content until a cut control waits wholly behind the foot", () => {
		expect(clearOfFoot(294, foot, [tools], 0)).toBe(215 - FOOT_MARGIN_PX + foot)
		// scrolled: the same row, measured from the content's top
		expect(clearOfFoot(200, foot, [tools], 50)).toBe(
			215 - FOOT_MARGIN_PX + foot - 50,
		)
	})

	it("and then a control above it, should that be cut instead", () => {
		const link = { top: 180, bottom: 212 }
		const height = clearOfFoot(294, foot, [link, tools], 0)
		expect(height).toBe(180 - FOOT_MARGIN_PX + foot)
		expect(clearOfFoot(height, foot, [link, tools], 0)).toBe(height)
	})
})
