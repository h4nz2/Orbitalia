/**
 * The phone's sheet (#60; docs/ARCHITECTURE.md, "The phone's sheet"): on a
 * phone held upright the body card, a dock panel, the tour card, the hunt, the
 * quick look and the time controls share one sheet from the bottom, one at a
 * time, at three heights.
 *
 * - `height`: where the sheet rests, `small` (one line of what it holds),
 *   `half` or `full` (up to just under the top row). Something new in the
 *   sheet starts at its kind's height (`DEFAULT_HEIGHT`); the viewer moves it
 *   with the handle, the header, a drag or the keyboard.
 * - `timeOpen`: the time controls are in the sheet (the time chip opens them).
 *   One of the dock's entries (`dock/exclusive.ts`), so opening them closes a
 *   panel and the other way round.
 * - `world`: what the sheet shows is a world's card, the one a sideways swipe
 *   moves on from (#62); the gesture hint waits for it.
 * - `bandPending`: the sheet is on its way to where it rests, and the band the
 *   camera frames into (#61) is written when it gets there. A shot that plans
 *   for the band waits for that (`whenSheetRests`).
 *
 * Nothing here is in the URL, and no sheet state is a step of the view
 * history (#46): the phone's back gesture keeps stepping through views.
 */
import { create } from "zustand"

export const SHEET_HEIGHTS = ["small", "half", "full"] as const
export type SheetHeight = (typeof SHEET_HEIGHTS)[number]

/** What the sheet shows, which decides the height it opens at. */
export type SheetKind =
	"card" | "panel" | "tour" | "hunt" | "quickLook" | "time"

/**
 * The height each kind opens at: the card small (the scene is the point), a
 * panel and the time half, a tour stop half (its words are the point), the
 * hunt's clue small (the scene must stay free to tap the answer; its chooser
 * is a panel), the quick look half.
 */
export const DEFAULT_HEIGHT: Readonly<Record<SheetKind, SheetHeight>> = {
	card: "small",
	panel: "half",
	tour: "half",
	hunt: "small",
	quickLook: "half",
	time: "half",
}

export const isSheetKind = (value: unknown): value is SheetKind =>
	typeof value === "string" && value in DEFAULT_HEIGHT

export interface SheetState {
	/** The sheet is on screen with something in it (a phone held upright). */
	active: boolean
	height: SheetHeight
	/** The time controls are in the sheet. */
	timeOpen: boolean
	/** A finger or the mouse is moving the sheet right now. */
	dragging: boolean
	/** It shows a world's card (#62). */
	world: boolean
	/** The band for where it is going has not been written yet. */
	bandPending: boolean
	setActive: (active: boolean) => void
	setHeight: (height: SheetHeight) => void
	setTimeOpen: (open: boolean) => void
	setDragging: (dragging: boolean) => void
	setWorld: (world: boolean) => void
	setBandPending: (pending: boolean) => void
	/** Down to `small`, if the sheet is on screen and higher (a tap on the sky, #59). Returns whether it moved. */
	lower: () => boolean
}

export const useSheetStore = create<SheetState>()((set, get) => ({
	active: false,
	height: "small",
	timeOpen: false,
	dragging: false,
	world: false,
	bandPending: false,
	setActive: (active) => {
		if (get().active !== active) set({ active })
	},
	setHeight: (height) => {
		if (get().height !== height) set({ height })
	},
	setTimeOpen: (timeOpen) => {
		if (get().timeOpen !== timeOpen) set({ timeOpen })
	},
	setDragging: (dragging) => {
		if (get().dragging !== dragging) set({ dragging })
	},
	setWorld: (world) => {
		if (get().world !== world) set({ world })
	},
	setBandPending: (bandPending) => {
		if (get().bandPending !== bandPending) set({ bandPending })
	},
	lower: () => {
		if (!get().active || get().height === "small") return false
		set({ height: "small" })
		return true
	},
}))

/** The longest a shot waits for the sheet's band: it never goes without its move. */
const REST_WAIT_MS = 2000

/**
 * Runs `run` once the phone's sheet has written the band for where it rests:
 * what it shows has just changed, and the height follows. At once where there
 * is no sheet (a laptop, a phone on its side). Returns how to call it off.
 */
export function whenSheetRests(run: () => void): () => void {
	if (!useSheetStore.getState().active) {
		run()
		return () => {}
	}
	let stop = () => {}
	const go = () => {
		off()
		run()
	}
	// the sheet hears of what changed once this task is over: it has by the next frame
	const frame = requestAnimationFrame(() => {
		if (!useSheetStore.getState().bandPending) {
			go()
			return
		}
		stop = useSheetStore.subscribe((state) => {
			if (!state.bandPending) go()
		})
	})
	const cap = setTimeout(go, REST_WAIT_MS)
	const off = () => {
		cancelAnimationFrame(frame)
		clearTimeout(cap)
		stop()
	}
	return off
}
