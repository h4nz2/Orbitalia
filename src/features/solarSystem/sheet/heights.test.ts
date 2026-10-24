import { describe, expect, it } from "vitest"

import {
	CLOSE_SHARE,
	FLICK_PX_PER_MS,
	FOOT_MARGIN_PX,
	HANDLE_PX,
	MAX_LOWER_PX,
	HANDLE_RISE_PX,
	STRIP_PX,
	clearOfFoot,
	contentPx,
	distinctHeights,
	handleSpan,
	nextHeight,
	restingHeight,
	stepHeight,
	stripPx,
	type ContentSizes,
	type Span,
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
		// scrolled by 50: the same cut, the same row, measured from the content's top
		expect(clearOfFoot(294 - 50, foot, [tools], 50)).toBe(
			215 - FOOT_MARGIN_PX + foot - 50,
		)
		// scrolled by 50, 200 px high: the foot's top (194) is above the row, which waits
		// behind it whole; never higher
		expect(clearOfFoot(200, foot, [tools], 50)).toBe(200)
	})

	it("and then a control beside it that reaches higher, should that be cut instead", () => {
		const link = { top: 180, bottom: 230 }
		const height = clearOfFoot(294, foot, [link, tools], 0)
		expect(height).toBe(180 - FOOT_MARGIN_PX + foot)
		expect(clearOfFoot(height, foot, [link, tools], 0)).toBe(height)
	})

	it("keeps no room where the room would cut the control right above it", () => {
		// a list of buttons one under the other: the cut one waits, the one above stays whole
		const list = Array.from({ length: 10 }, (_, i) => ({
			top: 20 + 48 * i,
			bottom: 68 + 48 * i,
		}))
		const height = clearOfFoot(300 + foot, foot, list, 0)
		expect(height).toBe(260 + foot)
		expect(clearOfFoot(height, foot, list, 0)).toBe(height)
		// with a gap above, the room is kept
		const link = { top: 180, bottom: 210 }
		expect(clearOfFoot(294, foot, [link, tools], 0)).toBe(
			215 - FOOT_MARGIN_PX + foot,
		)
	})

	it("never lowers by more than a control and a line: then the fade does it", () => {
		// a tall control: keeping it whole would take far more
		const picture = { top: 60, bottom: 300 }
		expect(clearOfFoot(250 + foot, foot, [picture], 0)).toBe(250 + foot)
		expect(MAX_LOWER_PX).toBeGreaterThanOrEqual(44 + FOOT_MARGIN_PX + 30)
	})
})

describe("a sliced line never rests above the foot or the entry buttons (#75)", () => {
	// a stop's words: lines of 21 px from 40 px down (their line boxes, leading included)
	const lines: Span[] = Array.from({ length: 12 }, (_, i) => ({
		top: 40 + 21 * i,
		bottom: 61 + 21 * i,
		line: true,
	}))
	const foot = 56

	it("stops on a whole line: the cut one waits wholly behind the foot", () => {
		// the foot's top at 230 would cut the line at 229-250
		const height = clearOfFoot(286, foot, lines, 0)
		expect(height).toBe(229 + foot)
		// lines touch: the one above is whole, nothing else moves
		expect(clearOfFoot(height, foot, lines, 0)).toBe(height)
	})

	it("leaves a height alone whose edge falls between two lines", () => {
		expect(clearOfFoot(250 + foot, foot, lines, 0)).toBe(250 + foot)
	})

	it("counts the scroll, and with no foot stops above the entry buttons", () => {
		// scrolled by 30: the edge at 30 + 200 = 230 cuts the line at 229-250
		expect(clearOfFoot(200, 0, lines, 30)).toBe(229 - 30)
	})

	it("keeps a control its room, a line none, whichever is cut first", () => {
		const button = { top: 271, bottom: 315 }
		const words = lines.slice(0, 11)
		// the edge at 300 cuts the button, which waits behind the foot; its room would
		// cut the last line (250-271) right above it, so it waits with none
		const height = clearOfFoot(300 + foot, foot, [...words, button], 0)
		expect(height).toBe(271 + foot)
		expect(clearOfFoot(height, foot, [...words, button], 0)).toBe(height)
		// with room to spare above the button, only the button waits
		const spaced = [...lines.slice(0, 10), { top: 275, bottom: 319 }]
		expect(clearOfFoot(300 + foot, foot, spaced, 0)).toBe(
			275 - FOOT_MARGIN_PX + foot,
		)
	})

	it("is never higher, and never below nothing", () => {
		expect(clearOfFoot(90, foot, lines, 0)).toBeLessThanOrEqual(90)
		expect(clearOfFoot(10, foot, lines, 0)).toBe(10)
	})
})

describe("the handle has a strip of its own (#75)", () => {
	it("is a finger's target at every height", () => {
		for (const height of ["small", "half", "full"] as const) {
			const span = handleSpan(height)
			expect(span.bottom - span.top).toBe(HANDLE_PX)
		}
	})

	it("ends where the content begins, so it never lies over a header or its one line", () => {
		for (const height of ["small", "half", "full"] as const)
			expect(handleSpan(height).bottom).toBeLessThanOrEqual(stripPx(height))
		expect(handleSpan("small").bottom).toBe(STRIP_PX)
	})

	it("reaches above the sheet only into the time chip's gap, not as far as a planet 10 px up", () => {
		for (const height of ["small", "half", "full"] as const)
			expect(handleSpan(height).top).toBeGreaterThanOrEqual(-HANDLE_RISE_PX)
		// the chip floats 0.5rem above the sheet: the handle meets it, never covers it
		expect(HANDLE_RISE_PX).toBeLessThanOrEqual(8)
		expect(HANDLE_RISE_PX).toBeLessThan(10)
	})
})
