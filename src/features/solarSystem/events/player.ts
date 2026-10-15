/**
 * Playing a sky event (#41) through the guided-tour player of #28: an event
 * is a tour whose stops are its views (`eventTour`). Starting one sets the
 * whole scene; `leaveEvent` (the tour's exit) goes back to the view, time and
 * scale the viewer had before, one action.
 */
import { eventOfTourId, skyEventById, type SkyEvent } from "@/data/skyEvents"
import { useSimStore } from "@/store/sim"
import { useSpacecraftStore } from "@/store/spacecraft"
import { useTourStore } from "@/store/tour"
import { isPhone } from "@/utils/sizeClasses"

import { exitTour, goToStop, startTour } from "../tours/player"
import { eventTour, viewIndex, type EventView } from "./staging"

export interface StartEventOptions {
	/** Which view to open on (default: from space). */
	view?: EventView
	/** Without animation (a link opening on it). */
	jump?: boolean
}

/** Starts sky event `id` (unknown ids are ignored). */
export function startEvent(
	id: string,
	{ view = "space", jump = false }: StartEventOptions = {},
): void {
	const event = skyEventById.get(id)
	if (event === undefined) return
	const { view: current } = useSimStore.getState()
	const tour = eventTour(event, current.kind !== "overview" && !jump)
	startTour(tour, { startAt: viewIndex(tour, view) ?? 0, jump })
	// on a phone the card starts folded, so the event itself is in view
	if (isPhone()) useTourStore.getState().setCollapsed(true)
	const craft = event.space?.craft
	if (craft !== undefined) useSpacecraftStore.getState().selectCraft(craft)
}

/** Switches the running event to its view from space or from Earth. */
export function showEventView(view: EventView): void {
	const { tour } = useTourStore.getState()
	if (tour === null || eventOfTourId(tour.id) === null) return
	const index = viewIndex(tour, view)
	if (index !== null) goToStop(index)
}

/** Leaves the event: back to where the viewer was before it. */
export const leaveEvent = (): void => exitTour()

/** The event being shown, if any. */
export const useActiveEvent = (): SkyEvent | null =>
	useTourStore((state) =>
		state.tour === null ? null : eventOfTourId(state.tour.id),
	)
