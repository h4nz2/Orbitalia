import { describe, expect, it } from "vitest"

import { createLabelBoard, keepOutSelector, measureKeepOut } from "./board"

/** A stand-in for an element: only its box. */
const box = (left: number, top: number, width: number, height: number) => ({
	getBoundingClientRect: () =>
		({ left, top, width, height }) as unknown as DOMRect,
})

describe("the areas names keep out from under", () => {
	it("are every HUD panel, everything in the dock and a phone's whole sheet (#74)", () => {
		const parts = keepOutSelector("panel_x1").split(", ")
		expect(parts).toEqual([".panel_x1", "[data-dock] > *", "[data-sheet]"])
	})

	it("are measured from the canvas, an empty one skipped", () => {
		// a page where the birthday panel has a class of its own, but sits in the dock
		const found: Record<string, ReturnType<typeof box>[]> = {
			".panel_x1": [box(10, 20, 300, 60)],
			"[data-dock] > *": [box(1000, 300, 340, 420), box(1000, 0, 0, 0)],
			"[data-sheet]": [],
		}
		const root = {
			querySelectorAll: (selector: string) =>
				selector.split(", ").flatMap((part) => found[part] ?? []),
		} as unknown as ParentNode
		const board = createLabelBoard(4)
		measureKeepOut(
			board,
			box(0, 50, 1366, 718),
			keepOutSelector("panel_x1"),
			root,
		)
		const { keepOut, keepOutLength } = board.layout
		expect(keepOutLength).toBe(2)
		expect([...keepOut.slice(0, 8)]).toEqual([
			10, -30, 300, 60, 1000, 250, 340, 420,
		])
	})
})
