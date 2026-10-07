/**
 * Label placement in screen space (docs/ARCHITECTURE.md, "Labels"; #20). Pure,
 * no three.js or DOM: scene/../labels/Labels.tsx projects the bodies into a
 * `LabelLayout` every frame, this module decides which names are shown and
 * where, and labels/LabelLayer.tsx writes the result into the DOM.
 *
 * The rules, in the order they apply:
 *
 * 1. Who may have a label at all (`isLabelCandidate`): the Sun and the planets
 *    always; a moon only within the focus family (the same rule as its marker
 *    dot), or while it is hovered or selected. From afar the moons of a planet
 *    sit within a few pixels of it and would only bury its name.
 * 2. Who is actually visible (./project.ts): a body in front of the camera,
 *    not hidden behind a nearer disc (`isOccluded`) or a HUD panel
 *    (`isKeptOut`), and for a moon of a planet that is still a dot, clear of
 *    that dot by `MOON_MIN_SEPARATION_PX` (`isClearOfParent`).
 *    Approaching a planet pulls its moons apart on screen and their names fade
 *    in one by one.
 * 3. Priority (`labelRank`): hovered, selected, focused, then the Sun, the
 *    planets, the featured moons (#17), the other moons; within a tier the
 *    larger body first.
 * 4. Placement (`placeLabels`): greedy in priority order. A label sits beside
 *    its body's disc (right, left, below, above, then the diagonals; the side
 *    it had last frame first, so labels do not hop), never on it, fully
 *    inside the viewport, never over another label and, if at all possible,
 *    never over another body's dot, never under a HUD panel. A label with no
 *    free side is hidden, never squeezed in. At most `MOON_LABEL_BUDGET` moon
 *    names show at once, the featured moons first, then the largest.
 *
 * Labels keep their on-screen size whatever the zoom (CSS, relative to the
 * viewport), so they are readable when a planet is one pixel and small beside
 * a planet that fills the screen.
 */
import type { Body, BodyKind } from "@/data"

/**
 * Where a label sits relative to its body's disc, in the order they are tried:
 * beside it (the way maps name cities), under and over it, then the diagonals.
 */
export const SIDE = {
	right: 0,
	left: 1,
	below: 2,
	above: 3,
	aboveRight: 4,
	belowRight: 5,
	aboveLeft: 6,
	belowLeft: 7,
	/** Centred on the anchor: orbit names, written across their line. */
	centre: 8,
} as const
export type Side = (typeof SIDE)[keyof typeof SIDE]
const SIDES: readonly Side[] = [0, 1, 2, 3, 4, 5, 6, 7]
const DIAGONAL = Math.SQRT1_2

/** Gap between a body's disc (or dot) and its label, px. */
export const LABEL_GAP_PX = 5
/** Labels keep this far from the viewport's edges, px. */
export const LABEL_EDGE_MARGIN_PX = 4
/** A moon's name shows only once the moon is this far outside its planet's disc, px. */
export const MOON_MIN_SEPARATION_PX = 10
/**
 * Hysteresis, px: a label that is showing survives overlaps this small where
 * it is, one that is hidden or moves to another side needs this much clear
 * space more, so a label on the edge of a collision does not flicker while the
 * camera moves.
 */
export const LABEL_HYSTERESIS_PX = 2
/**
 * Discs up to this radius (px) are dots other labels keep clear of; a bigger
 * disc is a surface, and moon names may lie across a planet's face.
 */
export const OBSTACLE_MAX_RADIUS_PX = 24
/**
 * At most this many moon names at once (the hovered, selected or focused moon
 * and moons whose disc is at least `MOON_DISC_NAMED_PX` wide are extra). Giant
 * planets have dozens of moons, most of them a few kilometres of rock; the
 * featured few (#17: up to 9 around Saturn) are the ones a lesson is about,
 * and more names are only noise.
 */
export const MOON_LABEL_BUDGET = 10
/** A moon drawn at least this radius (px) is a world on screen and always may be named. */
export const MOON_DISC_NAMED_PX = 8
/** Screen rectangles labels keep out of (HUD panels), at most. */
export const MAX_KEEP_OUT = 16
/** Extra room around a label that still counts as a hit on it, px. */
export const LABEL_PICK_PAD_PX = 3

/** Every value the layout needs, per body index; reused every frame. */
export interface LabelLayout {
	readonly count: number
	/** Body centre on screen, px from the top-left of the canvas. */
	readonly cx: Float64Array
	readonly cy: Float64Array
	/** Drawn disc radius on screen (at least the marker dot's), px. */
	readonly radius: Float64Array
	/** Centred on its anchor (`SIDE.centre`) instead of beside a disc. */
	readonly centred: Uint8Array
	/** Distance from the camera, for occlusion (any unit, larger = farther). */
	readonly depth: Float64Array
	/** The label box as the DOM measured it, px; 0 = not measured, never shown. */
	readonly width: Float32Array
	readonly height: Float32Array
	/** Candidate this frame and on screen, not occluded, clear of its parent. */
	readonly eligible: Uint8Array
	/** Placed this frame. */
	readonly visible: Uint8Array
	/** The side it was placed on, or -1 when never placed. */
	readonly side: Int8Array
	/** Top-left of the label box, px (for a hidden label: where it last was, for fading out). */
	readonly x: Float64Array
	readonly y: Float64Array
	/** Sort key, lower first (`labelRank`). */
	readonly rank: Float64Array
	/** Candidates this frame, highest priority first; `orderLength` of them. */
	readonly order: Int32Array
	orderLength: number
	/** Placed labels in placement order; `placedLength` of them. */
	readonly placed: Int32Array
	placedLength: number
	/** How much of each label shows, 0..1 (faded by `fadeLabels`). */
	readonly opacity: Float32Array
	/** Counts against `MOON_LABEL_BUDGET` (set per frame by the projection). */
	readonly budgeted: Uint8Array
	/** How many budgeted labels may be placed per frame. */
	budget: number
	/** Rectangles no label may overlap (HUD panels): x, y, width, height px. */
	readonly keepOut: Float64Array
	keepOutLength: number
	/** Viewport size of the last layout, px. */
	viewportWidth: number
	viewportHeight: number
}

export const createLabelLayout = (count: number): LabelLayout => ({
	count,
	cx: new Float64Array(count),
	cy: new Float64Array(count),
	radius: new Float64Array(count),
	centred: new Uint8Array(count),
	depth: new Float64Array(count),
	width: new Float32Array(count),
	height: new Float32Array(count),
	eligible: new Uint8Array(count),
	visible: new Uint8Array(count),
	side: new Int8Array(count).fill(-1),
	x: new Float64Array(count),
	y: new Float64Array(count),
	rank: new Float64Array(count),
	order: new Int32Array(count),
	orderLength: 0,
	placed: new Int32Array(count),
	placedLength: 0,
	opacity: new Float32Array(count),
	budgeted: new Uint8Array(count),
	budget: MOON_LABEL_BUDGET,
	keepOut: new Float64Array(MAX_KEEP_OUT * 4),
	keepOutLength: 0,
	viewportWidth: 0,
	viewportHeight: 0,
})

/** Sets the rectangles labels keep out of (x, y, width, height, px); extras beyond `MAX_KEEP_OUT` are dropped. */
export function setKeepOut(
	layout: LabelLayout,
	rects: readonly { x: number; y: number; width: number; height: number }[],
): void {
	let n = 0
	for (const rect of rects) {
		if (n >= MAX_KEEP_OUT) break
		if (rect.width <= 0 || rect.height <= 0) continue
		layout.keepOut[n * 4] = rect.x
		layout.keepOut[n * 4 + 1] = rect.y
		layout.keepOut[n * 4 + 2] = rect.width
		layout.keepOut[n * 4 + 3] = rect.height
		n++
	}
	layout.keepOutLength = n
}

export interface LabelState {
	focusId: string
	selectedId: string | null
	hoverId: string | null
	showMoons: boolean
	showAllMoons: boolean
}

/**
 * Whether a body may be labelled at all this frame (rule 1). `focusParentId`
 * is the focus's parent (null for the Sun). Moons follow their marker dots:
 * only the focus family, only while moons are shown (the focus always is).
 */
export const isLabelCandidate = (
	body: Pick<Body, "id" | "kind" | "parentId">,
	state: LabelState,
	focusParentId: string | null,
): boolean => {
	if (body.kind !== "moon") return true
	if (body.id === state.focusId) return true
	if (!state.showMoons) return false
	return (
		body.id === state.selectedId ||
		body.id === state.hoverId ||
		body.parentId === state.focusId ||
		(focusParentId !== null && body.parentId === focusParentId)
	)
}

const KIND_TIER: Record<BodyKind, number> = {
	star: 0,
	planet: 1,
	// #23: the small bodies rank below the planets; asteroids share the moons' tier
	dwarfPlanet: 2,
	comet: 3,
	moon: 4,
	asteroid: 4,
}

/** Sun 0, planets 1, featured moons 2, the long tail of moons 3 (#17). */
const labelTier = (body: Pick<Body, "kind" | "featured">): number =>
	KIND_TIER[body.kind] + (body.kind === "moon" && !body.featured ? 1 : 0)

/**
 * The static order of `bodies` for labelling: the Sun, the planets, the
 * featured moons, the other moons, the larger first within each; returned as
 * a rank per body index.
 */
export function staticLabelRanks(
	bodies: readonly Pick<Body, "kind" | "radiusKm" | "featured">[],
): Float64Array {
	const indices = bodies.map((_, i) => i)
	indices.sort(
		(a, b) =>
			labelTier(bodies[a]) - labelTier(bodies[b]) ||
			bodies[b].radiusKm - bodies[a].radiusKm ||
			a - b,
	)
	const ranks = new Float64Array(bodies.length)
	indices.forEach((body, rank) => (ranks[body] = rank))
	return ranks
}

/**
 * Priority of body `i` this frame (rule 3), lower first: whatever the user
 * points at wins, then the selection, then the focus, then the static order.
 */
export const labelRank = (
	id: string,
	staticRank: number,
	count: number,
	state: Pick<LabelState, "focusId" | "selectedId" | "hoverId">,
): number => {
	if (id === state.hoverId) return staticRank - 3 * count
	if (id === state.selectedId) return staticRank - 2 * count
	if (id === state.focusId) return staticRank - count
	return staticRank
}

/** Sorts `layout.order[0, orderLength)` by rank (insertion sort: short, allocation-free, stable). */
export function sortByRank(layout: LabelLayout): void {
	const { order, rank } = layout
	for (let k = 1; k < layout.orderLength; k++) {
		const body = order[k]
		const key = rank[body]
		let j = k - 1
		while (j >= 0 && rank[order[j]] > key) {
			order[j + 1] = order[j]
			j--
		}
		order[j + 1] = body
	}
}

/** Whether the screen point (`x`, `y`) lies under a keep-out rectangle (a HUD panel). */
export function isKeptOut(layout: LabelLayout, x: number, y: number): boolean {
	const { keepOut } = layout
	for (let k = 0; k < layout.keepOutLength * 4; k += 4) {
		if (
			x >= keepOut[k] &&
			x <= keepOut[k] + keepOut[k + 2] &&
			y >= keepOut[k + 1] &&
			y <= keepOut[k + 1] + keepOut[k + 3]
		) {
			return true
		}
	}
	return false
}

/** Whether body `i` sits behind a nearer, larger disc among the candidates (rule 2). */
export function isOccluded(layout: LabelLayout, i: number): boolean {
	const { order, cx, cy, radius, depth } = layout
	for (let k = 0; k < layout.orderLength; k++) {
		const j = order[k]
		if (j === i || radius[j] <= radius[i] || depth[j] >= depth[i]) continue
		const dx = cx[i] - cx[j]
		const dy = cy[i] - cy[j]
		if (dx * dx + dy * dy < radius[j] * radius[j]) return true
	}
	return false
}

/**
 * Whether a moon at (`cx`, `cy`) is clear enough of its parent's disc for its
 * name to show (rule 2); `wasVisible` applies the hysteresis.
 */
export const isClearOfParent = (
	dx: number,
	dy: number,
	parentRadius: number,
	wasVisible: boolean,
): boolean =>
	Math.hypot(dx, dy) - parentRadius >=
	MOON_MIN_SEPARATION_PX +
		(wasVisible ? -LABEL_HYSTERESIS_PX : LABEL_HYSTERESIS_PX)

/** Top-left of body `i`'s label on `side`, written into `layout.x/y[i]`. */
export function putOnSide(layout: LabelLayout, i: number, side: Side): void {
	const reach = layout.radius[i] + LABEL_GAP_PX
	const w = layout.width[i]
	const h = layout.height[i]
	const cx = layout.cx[i]
	const cy = layout.cy[i]
	switch (side) {
		case SIDE.right:
			layout.x[i] = cx + reach
			layout.y[i] = cy - h / 2
			break
		case SIDE.left:
			layout.x[i] = cx - reach - w
			layout.y[i] = cy - h / 2
			break
		case SIDE.below:
			layout.x[i] = cx - w / 2
			layout.y[i] = cy + reach
			break
		case SIDE.above:
			layout.x[i] = cx - w / 2
			layout.y[i] = cy - reach - h
			break
		// the box's nearest corner on the disc's 45° line
		case SIDE.aboveRight:
			layout.x[i] = cx + reach * DIAGONAL
			layout.y[i] = cy - reach * DIAGONAL - h
			break
		case SIDE.belowRight:
			layout.x[i] = cx + reach * DIAGONAL
			layout.y[i] = cy + reach * DIAGONAL
			break
		case SIDE.aboveLeft:
			layout.x[i] = cx - reach * DIAGONAL - w
			layout.y[i] = cy - reach * DIAGONAL - h
			break
		case SIDE.belowLeft:
			layout.x[i] = cx - reach * DIAGONAL - w
			layout.y[i] = cy + reach * DIAGONAL
			break
		case SIDE.centre:
			layout.x[i] = cx - w / 2
			layout.y[i] = cy - h / 2
			break
	}
}

const insideViewport = (layout: LabelLayout, i: number): boolean =>
	layout.x[i] >= LABEL_EDGE_MARGIN_PX &&
	layout.y[i] >= LABEL_EDGE_MARGIN_PX &&
	layout.x[i] + layout.width[i] <=
		layout.viewportWidth - LABEL_EDGE_MARGIN_PX &&
	layout.y[i] + layout.height[i] <= layout.viewportHeight - LABEL_EDGE_MARGIN_PX

/** Whether a circle overlaps a rectangle grown by `pad` on every side. */
const discHitsRect = (
	cx: number,
	cy: number,
	r: number,
	x: number,
	y: number,
	w: number,
	h: number,
	pad: number,
): boolean => {
	const nx = Math.max(x - pad, Math.min(cx, x + w + pad))
	const ny = Math.max(y - pad, Math.min(cy, y + h + pad))
	const dx = cx - nx
	const dy = cy - ny
	return dx * dx + dy * dy < r * r
}

/**
 * Whether body `i`'s label box collides with a placed label, or with a dot:
 * every eligible body's with `allDots`, else only the placed labels' bodies.
 */
function collides(
	layout: LabelLayout,
	i: number,
	pad: number,
	allDots: boolean,
): boolean {
	const { x, y, width, height, cx, cy, radius } = layout
	const x0 = x[i] - pad
	const y0 = y[i] - pad
	const x1 = x[i] + width[i] + pad
	const y1 = y[i] + height[i] + pad
	const { keepOut } = layout
	for (let k = 0; k < layout.keepOutLength * 4; k += 4) {
		if (
			x0 < keepOut[k] + keepOut[k + 2] &&
			x1 > keepOut[k] &&
			y0 < keepOut[k + 1] + keepOut[k + 3] &&
			y1 > keepOut[k + 1]
		) {
			return true
		}
	}
	for (let k = 0; k < layout.placedLength; k++) {
		const j = layout.placed[k]
		if (
			x0 < x[j] + width[j] &&
			x1 > x[j] &&
			y0 < y[j] + height[j] &&
			y1 > y[j]
		) {
			return true
		}
	}
	const dots = allDots ? layout.order : layout.placed
	const dotCount = allDots ? layout.orderLength : layout.placedLength
	for (let k = 0; k < dotCount; k++) {
		const j = dots[k]
		if (j === i || !layout.eligible[j]) continue
		if (radius[j] > OBSTACLE_MAX_RADIUS_PX) continue
		if (
			discHitsRect(
				cx[j],
				cy[j],
				radius[j],
				x[i],
				y[i],
				width[i],
				height[i],
				pad,
			)
		) {
			return true
		}
	}
	return false
}

/** Tries `side` for body `i`; places it and returns true when it fits. */
function tryPlace(
	layout: LabelLayout,
	i: number,
	side: Side,
	pad: number,
	allDots: boolean,
): boolean {
	putOnSide(layout, i, side)
	if (!insideViewport(layout, i) || collides(layout, i, pad, allDots)) {
		return false
	}
	layout.side[i] = side
	layout.visible[i] = 1
	layout.placed[layout.placedLength++] = i
	return true
}

/**
 * Places the labels of `layout.order` (rule 4). Reads `eligible`, `visible`
 * (last frame's, for the hysteresis), `side` (last frame's, tried first), the
 * geometry and the viewport; writes `visible`, `side`, `x`, `y` and `placed`.
 * A label that finds no place keeps the position of its last side, so it can
 * fade out where it was.
 */
export function placeLabels(layout: LabelLayout): void {
	layout.placedLength = 0
	let budgetLeft = layout.budget
	for (let k = 0; k < layout.orderLength; k++) {
		const i = layout.order[k]
		const wasVisible = layout.visible[i] === 1
		layout.visible[i] = 0
		if (!layout.eligible[i] || layout.width[i] <= 0 || layout.height[i] <= 0) {
			continue
		}
		const budgeted = layout.budgeted[i] === 1
		if (budgeted && budgetLeft <= 0) {
			putOnSide(layout, i, layout.side[i] >= 0 ? (layout.side[i] as Side) : 0)
			continue
		}
		// a shown label survives a small overlap where it is; moving to another
		// side is appearing there, which needs the clear space more
		const stay = wasVisible ? -LABEL_HYSTERESIS_PX : LABEL_HYSTERESIS_PX
		const centred = layout.centred[i] === 1
		const previous = centred ? SIDE.centre : layout.side[i]
		let placed = false
		// first clear of every dot, then (crowded) clear of the placed labels' dots only
		for (let pass = 0; pass < 2 && !placed; pass++) {
			const allDots = pass === 0
			if (previous >= 0) {
				placed = tryPlace(layout, i, previous as Side, stay, allDots)
			}
			for (let s = 0; s < SIDES.length && !placed && !centred; s++) {
				if (SIDES[s] === previous) continue
				placed = tryPlace(layout, i, SIDES[s], LABEL_HYSTERESIS_PX, allDots)
			}
		}
		if (!placed) putOnSide(layout, i, previous >= 0 ? (previous as Side) : 0)
		else if (budgeted) budgetLeft--
	}
}

/** Seconds a label takes to fade fully in or out. */
export const LABEL_FADE_S = 0.2

/**
 * Moves every label's opacity toward shown (placed this frame) or hidden, by
 * `dtS` seconds of fading. A label appears and disappears softly, which also
 * hides the rare frame a collision flips.
 */
export function fadeLabels(layout: LabelLayout, dtS: number): void {
	const step = Math.max(0, dtS) / LABEL_FADE_S
	const { opacity, visible } = layout
	for (let i = 0; i < layout.count; i++) {
		opacity[i] = visible[i]
			? Math.min(1, opacity[i] + step)
			: Math.max(0, opacity[i] - step)
	}
}

/**
 * The body whose shown label is under the screen point (`px`, `py`), or -1.
 * Only placed labels at least `minOpacity` visible count.
 */
export function pickLabel(
	layout: LabelLayout,
	px: number,
	py: number,
	minOpacity = 0.5,
): number {
	for (let k = 0; k < layout.placedLength; k++) {
		const i = layout.placed[k]
		if (layout.opacity[i] < minOpacity) continue
		if (
			px >= layout.x[i] - LABEL_PICK_PAD_PX &&
			px <= layout.x[i] + layout.width[i] + LABEL_PICK_PAD_PX &&
			py >= layout.y[i] - LABEL_PICK_PAD_PX &&
			py <= layout.y[i] + layout.height[i] + LABEL_PICK_PAD_PX
		) {
			return i
		}
	}
	return -1
}
