/**
 * The label board: the layout (./layout.ts) plus the DOM elements it is
 * written into. Created once per Canvas (scene/Scene.tsx) and shared by the
 * DOM layer outside the Canvas (LabelLayer.tsx, which renders and measures the
 * names) and the frame loop inside it (Labels.tsx, which lays them out and
 * moves them). Nothing here re-renders React: positions and opacity are
 * written straight into each element's style, and only when they changed.
 */
import { createLabelLayout, setKeepOut, type LabelLayout } from "./layout"

export interface LabelBoard {
	readonly layout: LabelLayout
	/** The label element per body index (null until mounted). */
	readonly elements: (HTMLElement | null)[]
	/** Last written x, y, opacity per body index; NaN = never written. */
	readonly written: Float64Array
}

export const createLabelBoard = (count: number): LabelBoard => ({
	layout: createLabelLayout(count),
	elements: new Array<HTMLElement | null>(count).fill(null),
	written: new Float64Array(count * 3).fill(Number.NaN),
})

/**
 * Registers the element of a slot (a React ref callback; null on unmount). A
 * new element starts hidden, so what was written to the old one is forgotten.
 */
export function attachLabel(
	board: LabelBoard,
	slot: number,
	element: HTMLElement | null,
): void {
	if (board.elements[slot] === element) return
	board.elements[slot] = element
	board.written.fill(Number.NaN, slot * 3, slot * 3 + 3)
}

/** Reads every label's box size from the DOM (after a render or a font load). */
export function measureLabels(board: LabelBoard): void {
	for (let i = 0; i < board.layout.count; i++) measureLabel(board, i)
}

/** Reads one label's box size from the DOM (a text that changes by itself: the light flash's clock, #74). */
export function measureLabel(board: LabelBoard, slot: number): void {
	const element = board.elements[slot]
	board.layout.width[slot] = element?.offsetWidth ?? 0
	board.layout.height[slot] = element?.offsetHeight ?? 0
}

/** Opacity is written in steps of 1/20, so a fade is 4 writes per label. */
const quantize = (opacity: number): number => Math.round(opacity * 20) / 20

/**
 * Writes the layout into the elements: `transform` (whole pixels, crisp
 * text), `opacity`, `visibility` (hidden labels are not painted) and
 * `data-visible` (shown at least half: what tests and tours can wait for).
 */
export function writeLabels(board: LabelBoard): void {
	const { layout, elements, written } = board
	for (let i = 0; i < layout.count; i++) {
		const element = elements[i]
		if (element === null) continue
		const o = i * 3
		const opacity = quantize(layout.opacity[i])
		if (opacity <= 0) {
			if (written[o + 2] !== 0) {
				element.style.visibility = "hidden"
				element.style.opacity = "0"
				element.dataset.visible = "false"
				written[o + 2] = 0
			}
			continue
		}
		const x = Math.round(layout.x[i])
		const y = Math.round(layout.y[i])
		if (x !== written[o] || y !== written[o + 1]) {
			element.style.transform = `translate(${x}px, ${y}px)`
			written[o] = x
			written[o + 1] = y
		}
		if (opacity !== written[o + 2]) {
			if (!(written[o + 2] > 0)) element.style.visibility = "visible"
			element.style.opacity = String(opacity)
			element.dataset.visible = opacity >= 0.5 ? "true" : "false"
			written[o + 2] = opacity
		}
	}
}

/** Hides every label at once (the Labels switch, or no layout this frame). */
export function hideLabels(board: LabelBoard): void {
	board.layout.opacity.fill(0)
	board.layout.visible.fill(0)
	board.layout.placedLength = 0
	writeLabels(board)
}

/**
 * What the names keep out from under, given the HUD panels' class: every HUD
 * panel, everything in the dock whatever its own class (#74: the birthday
 * and sky-tonight panels bring their own styles, and so may any later tool)
 * and the whole of a phone's sheet (#60, #62).
 */
export const keepOutSelector = (panelClass: string): string =>
	`.${panelClass}, [data-dock] > *, [data-sheet]`

/**
 * Reads the screen rectangles of the elements matching `selector` (the HUD
 * panels, `keepOutSelector`) relative to `canvas`, as the layout's keep-out
 * areas: a label half-hidden under a panel reads as a different word.
 */
export function measureKeepOut(
	board: LabelBoard,
	canvas: Pick<Element, "getBoundingClientRect">,
	selector: string,
	root: Pick<ParentNode, "querySelectorAll"> = document,
): void {
	const origin = canvas.getBoundingClientRect()
	setKeepOut(
		board.layout,
		Array.from(root.querySelectorAll(selector), (element) => {
			const rect = element.getBoundingClientRect()
			return {
				x: rect.left - origin.left,
				y: rect.top - origin.top,
				width: rect.width,
				height: rect.height,
			}
		}),
	)
}
