/**
 * The phone sheet's heights (#60), pure and unit-tested: how tall its content
 * is at each height, where a drag comes to rest, and where the handle steps.
 *
 * Heights are of the sheet's content (between the handle and the entry
 * buttons), in CSS px. Content shorter than a height shows whole at it, so
 * two heights may be the same; the handle and a drag skip the repeats.
 */
import { SHEET_HEIGHTS, type SheetHeight } from "@/store/sheet"

/** Of the screen's height, the whole sheet at `half` (handle, content and entry buttons). */
export const HALF_SHARE = 0.44

/** A flick at least this fast, px per ms, moves on to the next height whatever the distance. */
export const FLICK_PX_PER_MS = 0.5

/** Pulled down below `small` by this much of its height (or more), the sheet closes what it shows. */
export const CLOSE_SHARE = 0.5

export interface ContentSizes {
	/** The content's own height as it is laid out now. */
	natural: number
	/**
	 * Its height at `small`: the part that says what it is (a panel's header);
	 * `Infinity` for content that folds itself small (the card, a tour, the hunt).
	 */
	summary: number
	/** The most `half` may give the content. */
	halfCap: number
	/** The most `full` may give it: the sheet's top just under the top row. */
	fullCap: number
}

/** The content's height at `height`, px. */
export function contentPx(height: SheetHeight, sizes: ContentSizes): number {
	const cap =
		height === "small"
			? sizes.summary
			: height === "half"
				? sizes.halfCap
				: sizes.fullCap
	return Math.max(0, Math.round(Math.min(sizes.natural, cap)))
}

/** The heights that are really different, lowest first, with their px. */
export function distinctHeights(
	px: Readonly<Record<SheetHeight, number>>,
): { height: SheetHeight; px: number }[] {
	const out: { height: SheetHeight; px: number }[] = []
	for (const height of SHEET_HEIGHTS) {
		const last = out[out.length - 1]
		if (last !== undefined && px[height] <= last.px + 1) continue
		out.push({ height, px: px[height] })
	}
	return out
}

/** The handle's tap (Enter, Space): up a height, and from the top back to `small`. */
export function nextHeight(
	current: SheetHeight,
	px: Readonly<Record<SheetHeight, number>>,
): SheetHeight {
	const heights = distinctHeights(px)
	const at = heights.findIndex((entry) => entry.height === current)
	if (at < 0) return heights[0]?.height ?? "small"
	return heights[(at + 1) % heights.length].height
}

/** Up (1) or down (-1) one height (the arrow keys), staying at the ends. */
export function stepHeight(
	current: SheetHeight,
	direction: 1 | -1,
	px: Readonly<Record<SheetHeight, number>>,
): SheetHeight {
	const heights = distinctHeights(px)
	let at = heights.findIndex((entry) => entry.height === current)
	if (at < 0) {
		// a height that collapsed into a lower one: count from that one
		const target = px[current]
		at = heights.findIndex((entry) => entry.px >= target - 1)
		if (at < 0) at = heights.length - 1
	}
	const next = Math.min(heights.length - 1, Math.max(0, at + direction))
	return heights[next].height
}

/**
 * Where a drag released at `px` (content height) with `velocity` (px per ms,
 * positive upwards, the sheet growing) comes to rest: the next height in the
 * direction of a flick, else the nearest one; `close` when pulled well below
 * `small` and `closable`.
 */
export function restingHeight(
	px: number,
	velocity: number,
	heights: Readonly<Record<SheetHeight, number>>,
	closable: boolean,
): SheetHeight | "close" {
	const levels = distinctHeights(heights)
	const small = levels[0]
	if (
		closable &&
		px < small.px * (1 - CLOSE_SHARE) &&
		velocity <= FLICK_PX_PER_MS
	)
		return "close"
	if (closable && px < small.px && velocity < -FLICK_PX_PER_MS) return "close"
	if (Math.abs(velocity) >= FLICK_PX_PER_MS) {
		if (velocity > 0) {
			const up = levels.find((level) => level.px > px + 1)
			return (up ?? levels[levels.length - 1]).height
		}
		const down = [...levels].reverse().find((level) => level.px < px - 1)
		return (down ?? small).height
	}
	let best = small
	for (const level of levels)
		if (Math.abs(level.px - px) < Math.abs(best.px - px)) best = level
	return best.height
}

/** Where a control sits in the content, px from the content's top (not from the view). */
export interface Span {
	top: number
	bottom: number
}

/** Room kept between a control and a sticky foot it rests beside, px. */
export const FOOT_MARGIN_PX = 4

/**
 * The content's height `px` lowered so a sticky foot (`data-sheet-footer`: a
 * tour's Back and Next) never rests across a control (#60): with the content
 * scrolled by `scroll`, a control the foot's top would cut waits wholly
 * behind the foot instead, a scroll away (and so may one above it, cut in
 * turn). Lower, never higher: content that fits shows whole anyway, and
 * `half` keeps its share of the screen for the scene. Pure: `foot` is the
 * foot's height, `controls` the controls above it.
 */
export function clearOfFoot(
	px: number,
	foot: number,
	controls: readonly Span[],
	scroll: number,
): number {
	const cutAt = (height: number) => {
		const line = scroll + height - foot
		return controls.filter(
			(control) => control.top < line - 0.5 && control.bottom > line + 0.5,
		)
	}
	let height = px
	let cut = cutAt(height)
	// at most once for each control
	for (let i = 0; i < controls.length && cut.length > 0; i++) {
		height =
			Math.min(...cut.map((control) => control.top)) -
			FOOT_MARGIN_PX +
			foot -
			scroll
		cut = cutAt(height)
	}
	return Math.max(0, Math.floor(height))
}
