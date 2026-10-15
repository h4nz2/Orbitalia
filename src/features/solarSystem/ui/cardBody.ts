import type { SimState } from "@/store/sim"

/** The body the card is about: the selection, else the focused body; null in the overview or a free view. */
export const cardBodyId = (
	state: Pick<SimState, "selectedId" | "view">,
): string | null =>
	state.selectedId ?? (state.view.kind === "body" ? state.view.id : null)
