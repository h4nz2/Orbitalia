/**
 * The part of the screen the scene can be seen in (#61; docs/ARCHITECTURE.md,
 * "Framing what is free"). On a phone the HUD stacks its controls in bands
 * at the top and the bottom of the screen, so the camera centres what it
 * looks at in the band between them and fits it there; elsewhere nothing is
 * covered and the whole canvas is framed.
 *
 * Written by whatever covers the screen: today `dock/FreeArea.tsx`, which
 * measures the empty row of the phone's HUD grid; the bottom sheet (#60)
 * reports its resting height the same way. Read by the camera director
 * every frame (it eases to a new value, so a writer may jump) and by the
 * features that plan shots for the camera (the hunt, the moon system).
 */
import { create } from "zustand"

/**
 * The canvas (CSS px) and how much of it the HUD covers at its top and
 * bottom (px from each edge). `top` and `bottom` are 0 where nothing covers
 * the scene in bands (laptops, tablets, a phone on its side).
 */
export interface FreeArea {
	width: number
	height: number
	top: number
	bottom: number
}

/** Insets as shares of the canvas height (0..1), what the camera works with. */
export interface Insets {
	top: number
	bottom: number
}

export const NO_INSETS: Insets = Object.freeze({ top: 0, bottom: 0 })

/**
 * The least share of the height the camera frames into, whatever covers the
 * rest: a band thinner than this (a tall panel on a small phone) would shrink
 * the subject to a speck, so the camera then frames a band this high round
 * the free band's centre and lets the panels cover its edges.
 */
export const MIN_FREE_SHARE = 0.15

/** The window as it is, nothing covered (before the HUD has measured; tests: 0 x 0). */
const windowArea = (): FreeArea => ({
	width: typeof window === "undefined" ? 0 : window.innerWidth || 0,
	height: typeof window === "undefined" ? 0 : window.innerHeight || 0,
	top: 0,
	bottom: 0,
})

export interface FreeAreaState {
	area: FreeArea
	/** Sets the area; ignored when nothing changed by a whole pixel. */
	setArea: (area: FreeArea) => void
}

const samePx = (a: number, b: number): boolean => Math.abs(a - b) < 1

export const useFreeAreaStore = create<FreeAreaState>()((set, get) => ({
	area: windowArea(),
	setArea: (area) => {
		const now = get().area
		if (
			samePx(now.width, area.width) &&
			samePx(now.height, area.height) &&
			samePx(now.top, area.top) &&
			samePx(now.bottom, area.bottom)
		) {
			return
		}
		set({ area: { ...area } })
	},
}))

/**
 * The insets of `area` as shares of its height, with at least
 * `MIN_FREE_SHARE` of the height left between them (a band round the free
 * band's centre, kept on the canvas). No height: no insets. Written into
 * `out` (the camera asks every frame).
 */
export function insetShares(
	area: FreeArea,
	out: Insets = { top: 0, bottom: 0 },
): Insets {
	const height = area.height > 0 ? area.height : 0
	let top = height > 0 ? Math.max(0, area.top / height) : 0
	let bottom = height > 0 ? Math.max(0, area.bottom / height) : 0
	const free = 1 - top - bottom
	if ((top > 0 || bottom > 0) && free < MIN_FREE_SHARE) {
		// the band's centre, kept where a band of the least height still fits
		const half = MIN_FREE_SHARE / 2
		const centre = Math.min(1 - half, Math.max(half, top + free / 2))
		top = centre - half
		bottom = 1 - centre - half
	}
	out.top = top
	out.bottom = bottom
	return out
}

/** The canvas is taller than wide (an upright phone or tablet): the overview looks down more steeply. */
export const isUprightArea = (area: Pick<FreeArea, "width" | "height">) =>
	area.height > area.width && area.width > 0

/** Whether the screen in use is upright right now. */
export const isUprightScreen = (): boolean =>
	isUprightArea(useFreeAreaStore.getState().area)

/** The canvas's aspect and insets right now, for features that plan a shot. */
export function framingNow(): { aspect: number; insets: Insets } {
	const { area } = useFreeAreaStore.getState()
	return {
		aspect: area.width > 0 && area.height > 0 ? area.width / area.height : 1,
		insets: insetShares(area),
	}
}

export default useFreeAreaStore
