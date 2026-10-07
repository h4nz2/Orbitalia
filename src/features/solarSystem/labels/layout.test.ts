import { describe, expect, it } from "vitest"

import { bodies } from "@/data"

import {
	LABEL_EDGE_MARGIN_PX,
	LABEL_FADE_S,
	LABEL_GAP_PX,
	LABEL_HYSTERESIS_PX,
	MOON_LABEL_BUDGET,
	MOON_MIN_SEPARATION_PX,
	SIDE,
	createLabelLayout,
	fadeLabels,
	isClearOfParent,
	isKeptOut,
	isLabelCandidate,
	isOccluded,
	labelRank,
	pickLabel,
	placeLabels,
	setKeepOut,
	sortByRank,
	staticLabelRanks,
	type LabelLayout,
	type LabelState,
} from "./layout"

const state = (patch: Partial<LabelState> = {}): LabelState => ({
	focusId: "sun",
	selectedId: null,
	hoverId: null,
	showMoons: true,
	showAllMoons: true,
	...patch,
})

interface Spot {
	cx: number
	cy: number
	r?: number
	w?: number
	h?: number
	depth?: number
}

/** A layout with one candidate per spot, in the given priority order. */
const layoutOf = (spots: Spot[], width = 800, height = 600): LabelLayout => {
	const layout = createLabelLayout(spots.length)
	layout.viewportWidth = width
	layout.viewportHeight = height
	spots.forEach((spot, i) => {
		layout.cx[i] = spot.cx
		layout.cy[i] = spot.cy
		layout.radius[i] = spot.r ?? 2
		layout.width[i] = spot.w ?? 60
		layout.height[i] = spot.h ?? 18
		layout.depth[i] = spot.depth ?? 100
		layout.eligible[i] = 1
		layout.rank[i] = i
		layout.order[i] = i
	})
	layout.orderLength = spots.length
	return layout
}

const rectOf = (layout: LabelLayout, i: number) => ({
	x0: layout.x[i],
	y0: layout.y[i],
	x1: layout.x[i] + layout.width[i],
	y1: layout.y[i] + layout.height[i],
})

const overlaps = (layout: LabelLayout, a: number, b: number): boolean => {
	const p = rectOf(layout, a)
	const q = rectOf(layout, b)
	return p.x0 < q.x1 && p.x1 > q.x0 && p.y0 < q.y1 && p.y1 > q.y0
}

/** Distance from a body's centre to the nearest point of its own label box. */
const clearance = (layout: LabelLayout, i: number): number => {
	const { x0, y0, x1, y1 } = rectOf(layout, i)
	const dx = Math.max(x0 - layout.cx[i], 0, layout.cx[i] - x1)
	const dy = Math.max(y0 - layout.cy[i], 0, layout.cy[i] - y1)
	return Math.hypot(dx, dy)
}

const placedIds = (layout: LabelLayout): number[] =>
	Array.from(layout.placed.slice(0, layout.placedLength))

describe("isLabelCandidate", () => {
	const io = { id: "io", kind: "moon" as const, parentId: "jupiter" }
	const mars = { id: "mars", kind: "planet" as const, parentId: "sun" }

	it("always labels the Sun and the planets", () => {
		expect(isLabelCandidate(mars, state(), null)).toBe(true)
		expect(isLabelCandidate(mars, state({ showMoons: false }), null)).toBe(true)
		expect(
			isLabelCandidate(
				{ id: "sun", kind: "star", parentId: null },
				state({ focusId: "io" }),
				"jupiter",
			),
		).toBe(true)
	})

	it("labels moons only within the focus family", () => {
		expect(isLabelCandidate(io, state(), null)).toBe(false)
		expect(isLabelCandidate(io, state({ focusId: "earth" }), "sun")).toBe(false)
		expect(isLabelCandidate(io, state({ focusId: "jupiter" }), "sun")).toBe(
			true,
		)
		expect(isLabelCandidate(io, state({ focusId: "europa" }), "jupiter")).toBe(
			true,
		)
		expect(isLabelCandidate(io, state({ focusId: "io" }), "jupiter")).toBe(true)
	})

	it("labels a moon the user points at or selected, unless moons are off", () => {
		expect(isLabelCandidate(io, state({ hoverId: "io" }), null)).toBe(true)
		expect(isLabelCandidate(io, state({ selectedId: "io" }), null)).toBe(true)
		expect(
			isLabelCandidate(
				io,
				state({ focusId: "jupiter", showMoons: false }),
				"sun",
			),
		).toBe(false)
		// the focus is always shown, and so is its name
		expect(
			isLabelCandidate(io, state({ focusId: "io", showMoons: false }), null),
		).toBe(true)
	})
})

describe("priority", () => {
	const ranks = staticLabelRanks(bodies)
	const rankOf = (id: string) => ranks[bodies.findIndex((b) => b.id === id)]

	it("orders the Sun, then the planets by size, then the moons by size", () => {
		expect(rankOf("sun")).toBe(0)
		expect(rankOf("jupiter")).toBe(1)
		expect(rankOf("saturn")).toBe(2)
		expect(rankOf("mercury")).toBe(8)
		// then the dwarf planets and the comets (#23), then the moons
		const small = bodies.filter(
			(b) => b.kind === "dwarfPlanet" || b.kind === "comet",
		).length
		expect(rankOf("pluto")).toBeLessThan(rankOf("halley"))
		expect(rankOf("ganymede")).toBe(9 + small)
		expect(rankOf("titan")).toBe(10 + small)
		expect(rankOf("moon")).toBeLessThan(rankOf("europa"))
		expect(new Set(ranks).size).toBe(bodies.length)
	})

	it("puts what the user points at first, then the selection, then the focus", () => {
		const s = { focusId: "io", selectedId: "europa", hoverId: "adrastea" }
		const n = bodies.length
		const rank = (id: string) => labelRank(id, rankOf(id), n, s)
		expect(rank("adrastea")).toBeLessThan(rank("europa"))
		expect(rank("europa")).toBeLessThan(rank("io"))
		expect(rank("io")).toBeLessThan(rank("sun"))
		expect(rank("sun")).toBeLessThan(rank("jupiter"))
	})

	it("sorts the candidates by rank", () => {
		const layout = layoutOf([
			{ cx: 0, cy: 0 },
			{ cx: 0, cy: 0 },
			{ cx: 0, cy: 0 },
		])
		layout.rank.set([5, -1, 2])
		sortByRank(layout)
		expect(Array.from(layout.order)).toEqual([1, 2, 0])
	})
})

describe("placeLabels", () => {
	it("puts a lone label to the right of its body, clear of the disc", () => {
		const layout = layoutOf([{ cx: 400, cy: 300, r: 30 }])
		placeLabels(layout)
		expect(layout.visible[0]).toBe(1)
		expect(layout.side[0]).toBe(SIDE.right)
		expect(layout.x[0]).toBe(400 + 30 + LABEL_GAP_PX)
		expect(layout.y[0] + layout.height[0] / 2).toBe(300)
		expect(clearance(layout, 0)).toBeGreaterThanOrEqual(30 + LABEL_GAP_PX)
	})

	it("flips to another side at the edge of the screen, and never leaves it", () => {
		const layout = layoutOf([{ cx: 780, cy: 300 }])
		placeLabels(layout)
		expect(layout.side[0]).toBe(SIDE.left)
		const corner = layoutOf([{ cx: 790, cy: 590, w: 200 }])
		placeLabels(corner)
		expect(corner.side[0]).toBe(SIDE.aboveLeft)
		expect(corner.x[0] + 200).toBeLessThanOrEqual(790)
		// nowhere to go: a body filling the screen is named by the HUD, not a label
		const huge = layoutOf([{ cx: 400, cy: 300, r: 600 }])
		placeLabels(huge)
		expect(huge.visible[0]).toBe(0)
	})

	it("lets the more important label win a collision; the other moves or hides", () => {
		const moved = layoutOf([
			{ cx: 400, cy: 300 },
			{ cx: 400, cy: 310 },
		])
		placeLabels(moved)
		expect(placedIds(moved)).toEqual([0, 1])
		expect(moved.side[0]).toBe(SIDE.right)
		expect(moved.side[1]).toBe(SIDE.left)
		expect(overlaps(moved, 0, 1)).toBe(false)

		// four bodies on one spot: only the first can be named
		const crowd = layoutOf([
			{ cx: 400, cy: 300 },
			{ cx: 401, cy: 300 },
			{ cx: 400, cy: 301 },
			{ cx: 401, cy: 301 },
		])
		placeLabels(crowd)
		expect(crowd.visible[0]).toBe(1)
		for (const a of placedIds(crowd)) {
			for (const b of placedIds(crowd)) {
				if (a !== b) expect(overlaps(crowd, a, b)).toBe(false)
			}
		}
	})

	it("keeps labels off other bodies' dots when it can", () => {
		// a dot right where the label would go: the label takes the left side
		const layout = layoutOf([
			{ cx: 400, cy: 300 },
			{ cx: 440, cy: 300, w: 0 },
		])
		placeLabels(layout)
		expect(layout.side[0]).toBe(SIDE.left)
		// a planet's face is not a dot: a moon's name may lie across it
		const face = layoutOf([
			{ cx: 400, cy: 300 },
			{ cx: 500, cy: 300, r: 80, w: 0 },
		])
		placeLabels(face)
		expect(face.side[0]).toBe(SIDE.right)
	})

	it("keeps the side a label had, instead of hopping", () => {
		const layout = layoutOf([{ cx: 400, cy: 300 }])
		layout.side[0] = SIDE.below
		placeLabels(layout)
		expect(layout.side[0]).toBe(SIDE.below)
	})

	it("does not flicker on the edge of a collision (hysteresis)", () => {
		// body 1 sits under body 0; `gap` px between their right-hand labels
		const build = (gap: number, shownBefore: boolean) => {
			const layout = layoutOf([
				{ cx: 400, cy: 300 },
				{ cx: 400, cy: 318 + gap },
			])
			layout.side.fill(SIDE.right)
			layout.visible[1] = shownBefore ? 1 : 0
			placeLabels(layout)
			return layout.side[1]
		}
		// a showing label survives a 1 px overlap and stays put
		expect(build(-1, true)).toBe(SIDE.right)
		// a hidden one needs more than the hysteresis of clear space there
		expect(build(LABEL_HYSTERESIS_PX - 1, false)).toBe(SIDE.left)
		expect(build(LABEL_HYSTERESIS_PX + 1, false)).toBe(SIDE.right)
	})

	it("a shown label that has to move needs the clear space of a new one", () => {
		// both at the left edge, so a label on the left is off screen; body 1's
		// right-hand label would overlap body 0's by 1 px
		const layout = layoutOf([
			{ cx: 30, cy: 300 },
			{ cx: 30, cy: 317 },
		])
		layout.side[0] = SIDE.right
		layout.visible[0] = 1
		layout.side[1] = SIDE.left
		layout.visible[1] = 1
		placeLabels(layout)
		expect(layout.visible[1]).toBe(1)
		expect(layout.side[1]).not.toBe(SIDE.right)
		expect(overlaps(layout, 0, 1)).toBe(false)
	})

	it("holds its promises for any arrangement", () => {
		let seed = 7
		const random = () => {
			seed = (seed * 16807) % 2147483647
			return seed / 2147483647
		}
		for (let run = 0; run < 200; run++) {
			const spots: Spot[] = Array.from(
				{ length: 5 + Math.floor(random() * 40) },
				() => ({
					cx: random() * 800,
					cy: random() * 600,
					r: random() < 0.2 ? random() * 60 : 2,
					w: 30 + random() * 90,
					h: 14 + random() * 8,
				}),
			)
			const layout = layoutOf(spots)
			placeLabels(layout)
			const placed = placedIds(layout)
			expect(placed[0]).toBe(0)
			for (const i of placed) {
				// never on its own body
				expect(clearance(layout, i)).toBeGreaterThanOrEqual(
					layout.radius[i] + LABEL_GAP_PX - 1e-9,
				)
				// inside the screen
				expect(layout.x[i]).toBeGreaterThanOrEqual(LABEL_EDGE_MARGIN_PX)
				expect(layout.y[i]).toBeGreaterThanOrEqual(LABEL_EDGE_MARGIN_PX)
				expect(layout.x[i] + layout.width[i]).toBeLessThanOrEqual(800)
				expect(layout.y[i] + layout.height[i]).toBeLessThanOrEqual(600)
				// no label soup
				for (const j of placed) {
					if (i !== j) expect(overlaps(layout, i, j)).toBe(false)
				}
			}
		}
	})

	it("names at most MOON_LABEL_BUDGET budgeted bodies, in priority order", () => {
		const spots = Array.from({ length: 20 }, (_, i) => ({
			cx: 100 + (i % 4) * 150,
			cy: 60 + Math.floor(i / 4) * 100,
		}))
		const layout = layoutOf(spots)
		layout.budgeted.fill(1)
		layout.budgeted[0] = 0 // the planet
		placeLabels(layout)
		expect(placedIds(layout)).toEqual(
			Array.from({ length: MOON_LABEL_BUDGET + 1 }, (_, i) => i),
		)
	})

	it("keeps labels out from under the HUD panels", () => {
		const layout = layoutOf([{ cx: 400, cy: 300 }])
		setKeepOut(layout, [
			{ x: 405, y: 250, width: 200, height: 100 },
			{ x: 0, y: 0, width: 0, height: 0 },
		])
		expect(layout.keepOutLength).toBe(1)
		placeLabels(layout)
		expect(layout.side[0]).toBe(SIDE.left)
		expect(isKeptOut(layout, 500, 300)).toBe(true)
		expect(isKeptOut(layout, 400, 300)).toBe(false)
	})

	it("hides ineligible and unmeasured labels", () => {
		const layout = layoutOf([
			{ cx: 100, cy: 100 },
			{ cx: 400, cy: 300, w: 0 },
		])
		layout.eligible[0] = 0
		placeLabels(layout)
		expect(layout.placedLength).toBe(0)
	})
})

describe("eligibility", () => {
	it("hides a body behind a nearer, larger disc", () => {
		const layout = layoutOf([
			{ cx: 400, cy: 300, r: 50, depth: 10 },
			{ cx: 420, cy: 310, r: 2, depth: 20 },
			{ cx: 420, cy: 310, r: 2, depth: 5 },
			{ cx: 470, cy: 300, r: 2, depth: 20 },
		])
		expect(isOccluded(layout, 0)).toBe(false)
		expect(isOccluded(layout, 1)).toBe(true)
		expect(isOccluded(layout, 2)).toBe(false)
		expect(isOccluded(layout, 3)).toBe(false)
	})

	it("shows a moon's name only once it is clear of its planet's dot", () => {
		const r = 4
		const edge = r + MOON_MIN_SEPARATION_PX
		expect(isClearOfParent(edge + LABEL_HYSTERESIS_PX, 0, r, false)).toBe(true)
		expect(isClearOfParent(edge, 0, r, false)).toBe(false)
		expect(isClearOfParent(edge, 0, r, true)).toBe(true)
		expect(isClearOfParent(edge - LABEL_HYSTERESIS_PX - 1, 0, r, true)).toBe(
			false,
		)
	})
})

describe("fading and picking", () => {
	it("fades labels in and out over LABEL_FADE_S", () => {
		const layout = layoutOf([
			{ cx: 400, cy: 300 },
			{ cx: 100, cy: 100 },
		])
		layout.opacity[1] = 1
		placeLabels(layout)
		layout.visible[1] = 0
		fadeLabels(layout, LABEL_FADE_S / 2)
		expect(layout.opacity[0]).toBeCloseTo(0.5)
		expect(layout.opacity[1]).toBeCloseTo(0.5)
		fadeLabels(layout, LABEL_FADE_S)
		expect(layout.opacity[0]).toBe(1)
		expect(layout.opacity[1]).toBe(0)
	})

	it("hits a shown label's box (with a little slack) and nothing else", () => {
		const layout = layoutOf([{ cx: 400, cy: 300 }])
		placeLabels(layout)
		expect(pickLabel(layout, layout.x[0] + 5, 300)).toBe(-1) // not faded in yet
		layout.opacity[0] = 1
		expect(pickLabel(layout, layout.x[0] + 5, 300)).toBe(0)
		expect(pickLabel(layout, layout.x[0] - 2, 300)).toBe(0)
		expect(pickLabel(layout, layout.x[0] - 10, 300)).toBe(-1)
		expect(pickLabel(layout, layout.x[0] + 5, 360)).toBe(-1)
	})
})
