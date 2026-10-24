/**
 * Spacecraft UI state (issue #35, docs/ARCHITECTURE.md, "Spacecraft"): the
 * layer switch, which craft is selected or pointed at, and whether every
 * craft's path is drawn. Separate from the navigation slice, which knows only
 * bodies: a selected craft is shown in the info panel instead of a body.
 *
 * Selecting a craft clears the body selection; selecting a body (a click, the
 * picker) or leaving for the overview (the home button, Escape) clears the
 * craft selection, so the info panel always shows what was chosen last.
 *
 * The layer is off until somebody asks for it (#70): its switch (Layers, or
 * Tools → Real spacecraft), a link with `spacecraft=true` (the URL sync
 * mirrors it, see urlSync.ts), or choosing a craft. `selectCraft` is the one
 * way every feature chooses one (the list, a link, following, a milestone, a
 * tour stop, a sky event, Back, Back to the start, a marker), so a chosen
 * craft is never invisible. Once on, the layer stays on until it is turned off.
 */
import { create } from "zustand"

import { useSimStore } from "./sim"

export interface SpacecraftState {
	/** The spacecraft layer (markers, names, paths); off by default, on whenever a craft is chosen. */
	showSpacecraft: boolean
	/** Draw every craft's path, not only the selected one's. */
	showAllPaths: boolean
	selectedCraftId: string | null
	hoverCraftId: string | null
	/** The trajectories have been loaded (they arrive after the page, see @/data/spacecraft). */
	trajectoriesReady: boolean

	setShowSpacecraft: (show: boolean) => void
	setShowAllPaths: (show: boolean) => void
	/**
	 * Selects a craft (clearing the body selection and showing the layer), or
	 * clears the craft selection (the layer stays as it is).
	 */
	selectCraft: (id: string | null) => void
	setHoverCraft: (id: string | null) => void
}

export const useSpacecraftStore = create<SpacecraftState>()((set, get) => ({
	showSpacecraft: false,
	showAllPaths: false,
	selectedCraftId: null,
	hoverCraftId: null,
	trajectoriesReady: false,

	setShowSpacecraft: (show) => {
		// a hidden layer has nothing selected or pointed at
		set(
			show
				? { showSpacecraft: true }
				: { showSpacecraft: false, selectedCraftId: null, hoverCraftId: null },
		)
	},
	setShowAllPaths: (show) => set({ showAllPaths: show }),
	selectCraft: (id) => {
		const { selectedCraftId, showSpacecraft } = get()
		if (selectedCraftId === id && (id === null || showSpacecraft)) return
		// a chosen craft is drawn: choosing one shows the layer
		set(
			id === null
				? { selectedCraftId: null }
				: { selectedCraftId: id, showSpacecraft: true },
		)
		if (id !== null) useSimStore.getState().select(null)
	},
	setHoverCraft: (id) => {
		if (get().hoverCraftId !== id) set({ hoverCraftId: id })
	},
}))

// a body chosen, or the way out taken: the craft is no longer what the panel shows
useSimStore.subscribe((state, previous) => {
	if (useSpacecraftStore.getState().selectedCraftId === null) return
	const bodyChosen =
		state.selectedId !== previous.selectedId && state.selectedId !== null
	// a new request for the overview (even from the overview: the home button, Escape)
	const toOverview =
		state.transition !== previous.transition &&
		state.transition?.view.kind === "overview"
	if (bodyChosen || toOverview) {
		useSpacecraftStore.setState({ selectedCraftId: null })
	}
})

export default useSpacecraftStore
