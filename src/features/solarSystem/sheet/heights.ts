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

/** The handle's target, px: a finger's (#58). */
export const HANDLE_PX = 44

/**
 * How far the handle's target reaches above the sheet's top, px, at small and
 * half (#75): into the gap under the time chip (its 0.5rem in
 * SolarSystem.module.css), never over the chip, and never over a planet a tap
 * lands on 10 px above the sheet.
 */
export const HANDLE_RISE_PX = 8

/**
 * The handle's strip above the content, px: the rest of the handle's target,
 * so the target never lies over the header or the one line under it (#75).
 * At full the strip also holds the time chip, and the handle sits in it.
 */
export const STRIP_PX = HANDLE_PX - HANDLE_RISE_PX
export const STRIP_FULL_PX = 60

/** Where the handle's target lies, px from the top of the sheet's strip. */
export function handleSpan(height: SheetHeight): Span {
	if (height === "full") {
		const top = (STRIP_FULL_PX - HANDLE_PX) / 2
		return { top, bottom: top + HANDLE_PX }
	}
	return { top: -HANDLE_RISE_PX, bottom: STRIP_PX }
}

/** The strip's height at `height`, px. */
export const stripPx = (height: SheetHeight): number =>
	height === "full" ? STRIP_FULL_PX : STRIP_PX

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

/**
 * Where a control or a line of text sits in the content, px from the
 * content's top (not from the view).
 */
export interface Span {
	top: number
	bottom: number
	/** A line of text (its line box, leading included): it keeps no room of its own. */
	line?: boolean
}

/** Room kept between a control and the edge it rests above, px. */
export const FOOT_MARGIN_PX = 4

/**
 * The most the edge is lowered to keep things whole, px: a control and a
 * line. Where that would take more (a tall control, things side by side in
 * steps), the height stays and the fade above the edge does the work (#75).
 */
export const MAX_LOWER_PX = 96

/**
 * The content's height `px` lowered so its lower edge never rests across a
 * control or a line of text (#60, #75): with the content scrolled by
 * `scroll`, a control or a line that edge would cut waits wholly behind it
 * instead, a scroll away (and so may one beside it that reaches higher, cut
 * in turn). The edge is the top of a sticky foot `foot` px high
 * (`data-sheet-footer`: a tour's Back and Next), or with `foot` 0 the
 * content's own bottom, where the entry buttons begin. A control keeps a
 * little room above it, unless that room would cut the one right above it
 * (a list of buttons): then it waits with none. Lower, never higher, and
 * never by more than `MAX_LOWER_PX`: content that fits shows whole anyway,
 * and `half` keeps its share of the screen for the scene. Pure: `spans` are
 * the controls and the lines above the edge.
 */
export function clearOfFoot(
	px: number,
	foot: number,
	spans: readonly Span[],
	scroll: number,
): number {
	const cutAt = (edge: number) =>
		spans.filter((span) => span.top < edge - 0.5 && span.bottom > edge + 0.5)
	let edge = scroll + px - foot
	let cut = cutAt(edge)
	// at most once for each span
	for (let i = 0; i < spans.length && cut.length > 0; i++) {
		const top = Math.min(...cut.map((span) => span.top))
		edge = Math.min(
			...cut.map((span) => span.top - (span.line ? 0 : FOOT_MARGIN_PX)),
		)
		if (cutAt(edge).some((span) => span.bottom <= top + 0.5)) edge = top
		cut = cutAt(edge)
	}
	const height = Math.floor(edge + foot - scroll)
	if (px - height > MAX_LOWER_PX) return px
	return Math.max(0, Math.min(px, height))
}
