/**
 * Teacher and presentation mode (#29; docs/ARCHITECTURE.md, "Presentation").
 *
 * - `presenting`: projector mode, large type and big hit targets. In the URL
 *   as `present=true`, so a prepared lesson link opens ready for the projector.
 * - `highContrast`: solid panels and brighter text for washed-out projectors.
 *   In the URL as `contrast=high`; a viewer's `prefers-contrast: more` turns it
 *   on as well (see `features/solarSystem/present/usePresentationDocument.ts`).
 * - `chromeHidden`: every HUD panel hidden, just the solar system. Never in the
 *   URL: a link must never open without its way back.
 * - `startSearch`: the link the page was opened with, the "start of the
 *   lesson" that `R` / Home restore (`present/restoreStart.ts`).
 * - `announcement`: the last keyboard action or the flight's destination, read
 *   out by the live region.
 *
 * Per-frame code reads it with `usePresentationStore.getState()`; the HUD
 * subscribes through selectors.
 */
import { create } from "zustand"

import type { SimSearch } from "./simSearch"

export interface Announcement {
	readonly text: string
	/** Increments on every announcement, so the same text twice is read twice. */
	readonly id: number
}

export interface PresentationState {
	presenting: boolean
	highContrast: boolean
	chromeHidden: boolean
	/** The keyboard shortcuts dialog. */
	helpOpen: boolean
	/** The link's QR code, large, for the class to scan. */
	qrOpen: boolean
	/** The search params the page was opened with; null until the page seeds it. */
	startSearch: SimSearch | null
	announcement: Announcement | null

	setPresenting: (presenting: boolean) => void
	setHighContrast: (highContrast: boolean) => void
	setChromeHidden: (hidden: boolean) => void
	setHelpOpen: (open: boolean) => void
	setQrOpen: (open: boolean) => void
	setStartSearch: (search: SimSearch) => void
	announce: (text: string) => void
}

export const usePresentationStore = create<PresentationState>()((set, get) => ({
	presenting: false,
	highContrast: false,
	chromeHidden: false,
	helpOpen: false,
	qrOpen: false,
	startSearch: null,
	announcement: null,

	setPresenting: (presenting) => set({ presenting }),
	setHighContrast: (highContrast) => set({ highContrast }),
	setChromeHidden: (chromeHidden) => set({ chromeHidden }),
	setHelpOpen: (helpOpen) => set({ helpOpen }),
	setQrOpen: (qrOpen) => set({ qrOpen }),
	setStartSearch: (startSearch) => set({ startSearch }),
	announce: (text) =>
		set({ announcement: { text, id: (get().announcement?.id ?? 0) + 1 } }),
}))

/** The URL params of the presentation settings and of the clock's pause (#29). */
export type PresentationSearch = Pick<
	SimSearch,
	"present" | "contrast" | "paused"
>

/**
 * The params that mirror the presentation settings and the pause: defaults
 * (not presenting, normal contrast, running) are left out. A paused clock is
 * part of a prepared view: the teacher stopped on a moment, and the link must
 * open standing still there, not racing off at the link's speed.
 */
export const presentationSearch = (state: {
	presenting: boolean
	highContrast: boolean
	paused: boolean
}): PresentationSearch => ({
	present: state.presenting ? true : undefined,
	contrast: state.highContrast ? "high" : undefined,
	paused: state.paused ? true : undefined,
})

export const samePresentationSearch = (
	a: PresentationSearch,
	b: PresentationSearch,
): boolean =>
	a.present === b.present && a.contrast === b.contrast && a.paused === b.paused

/** The presentation settings a search opens with. */
export const presentationFromSearch = (
	search: SimSearch,
): Pick<PresentationState, "presenting" | "highContrast"> => ({
	presenting: search.present === true,
	highContrast: search.contrast === "high",
})
