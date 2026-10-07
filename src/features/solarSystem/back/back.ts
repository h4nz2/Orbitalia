/**
 * Back: return to where you just were (#46; docs/ARCHITECTURE.md, "Back: the
 * view history"). The bookkeeping is `src/store/viewHistory.ts`; this is what
 * going back does on the scene, and what the Back button, Backspace and the
 * tour's own Back ask for.
 *
 * Going back is the browser's back between two entries of the solar system,
 * so the button, the key, the browser's back and the phone's back gesture all
 * do the same: the URL sync sees the entry change and calls `returnTo` with
 * the waypoint kept for it. During a tour Back is the tour's previous stop.
 */
import { eventOfTourId } from "@/data/skyEvents"
import { FLIGHT_PROFILE } from "@/store/flight"
import {
	HOME_SHOT,
	OVERVIEW_BODY_ID,
	isFrameAnchored,
	viewBodyId,
	type CameraShot,
	type Sequence,
	type View,
	type ViewRequest,
} from "@/store/navigation"
import { useSimStore } from "@/store/sim"
import { useSpacecraftStore } from "@/store/spacecraft"
import { isListedTour, useTourStore, type TourState } from "@/store/tour"
import {
	canGoBack,
	entryBehind,
	historyBack,
	useViewHistoryStore,
	type TourAt,
	type ViewHistoryState,
	type Waypoint,
} from "@/store/viewHistory"

import { startEvent } from "../events/player"
import { EVENT_VIEWS } from "../events/staging"
import { prefersReducedMotion } from "../present/media"
import {
	exitTour,
	goToStop,
	previousStop,
	startTour,
	tourStatus,
} from "../tours/player"

/** The way into `to` from `from`: the flight of #18 between two bodies, else the default glide. */
export function returnRequest(
	from: View,
	to: View,
	shot: CameraShot | null,
	instant: boolean,
): ViewRequest {
	const trip =
		from.kind !== "overview" &&
		to.kind !== "overview" &&
		viewBodyId(from) !== viewBodyId(to)
	return {
		shot: shot ?? (to.kind === "overview" ? HOME_SHOT : undefined),
		profile: trip ? FLIGHT_PROFILE : undefined,
		durationMs: instant ? 0 : undefined,
	}
}

/** A tour stop: the tour's own move if it is open (its previous stop, or any other), else the tour begun there. */
function returnToStop({ id, index }: TourAt): void {
	const open = useTourStore.getState()
	if (open.tour?.id === id) {
		if (index === open.index - 1) previousStop()
		else goToStop(index)
		return
	}
	const event = eventOfTourId(id)
	if (event !== null) startEvent(event.id, { view: EVENT_VIEWS[index] })
	else startTour(id, { startAt: index })
}

/** A view: the body, spacecraft or point in space, flown to with the camera it was left with. */
function returnToView(target: Extract<Waypoint, { kind: "view" }>): void {
	const from = useSimStore.getState().view
	// back to before a tour began leaves it (a sky event returns to where it started)
	const open = useTourStore.getState().tour
	if (target.tour === null && open !== null && isListedTour(open.id)) exitTour()

	const request = returnRequest(
		from,
		target.view,
		target.shot,
		prefersReducedMotion(),
	)
	const sim = useSimStore.getState()
	if (target.frameId !== OVERVIEW_BODY_ID) {
		sim.anchorFrame(target.frameId, request)
		// a point near the body held still
		if (target.view.kind === "point") {
			useSimStore.getState().goTo(target.view, request)
		}
	} else {
		if (isFrameAnchored(sim)) sim.releaseFrame(request)
		useSimStore.getState().goTo(target.view, request)
	}
	useSimStore.getState().select(target.selectedId)
	useSpacecraftStore.getState().selectCraft(target.craftId)
}

/** Following a spacecraft (#57): it is followed again, from where the camera was left. */
function returnToFollow(target: Extract<Waypoint, { kind: "follow" }>): void {
	const open = useTourStore.getState().tour
	if (open !== null && isListedTour(open.id)) exitTour()
	const sim = useSimStore.getState()
	useSpacecraftStore.getState().selectCraft(target.craftId)
	// the neighbourhood is the camera rig's to put right as soon as the craft is drawn
	sim.goTo(
		{ kind: "craft", id: target.craftId, anchorId: sim.focusId },
		{
			shot: target.shot ?? undefined,
			durationMs: prefersReducedMotion() ? 0 : undefined,
		},
	)
}

/** Goes to `target`: what Back (and Forward) does once the browser is on its entry. */
export function returnTo(target: Waypoint): void {
	switch (target.kind) {
		case "tourStop":
			returnToStop(target.tour)
			return
		case "follow":
			returnToFollow(target)
			return
		case "view":
			returnToView(target)
			return
	}
}

/** A tour is playing (the camera on it) past its first stop: Back is its previous stop. */
export const tourHasPrevious = (
	sequence: Sequence | null,
	tour: Pick<TourState, "tour" | "index" | "steps">,
): boolean =>
	tour.tour !== null &&
	tour.index > 0 &&
	tourStatus(sequence, tour) === "playing"

/** Whether Back does anything now (the button is shown disabled otherwise). */
export const canStepBack = (
	history: Pick<ViewHistoryState, "index" | "entries"> &
		Partial<Pick<ViewHistoryState, "held">>,
	sequence: Sequence | null,
	tour: Pick<TourState, "tour" | "index" | "steps">,
): boolean =>
	history.held !== true &&
	(tourHasPrevious(sequence, tour) || canGoBack(history))

/**
 * The tour's Back (the card's button, the left arrow, Page Up; #28): the
 * previous stop. When the entry behind is that stop, through the browser's
 * history, so the browser's back and the app's agree on where Back goes.
 */
export function tourBack(): void {
	const { tour, index } = useTourStore.getState()
	if (tour === null) return
	const behind = entryBehind(useViewHistoryStore.getState())
	const toPrevious =
		behind?.kind === "tourStop" &&
		behind.tour.id === tour.id &&
		behind.tour.index === index - 1
	if (toPrevious && historyBack()) return
	previousStop()
}

/**
 * Back (the button, Backspace): the previous tour stop during a tour, else
 * the view before this one. Returns false when there is nothing to go back to.
 */
export function goBack(): boolean {
	// nothing while the opening plays (#49)
	if (useViewHistoryStore.getState().held) return false
	const tour = useTourStore.getState()
	if (tourHasPrevious(useSimStore.getState().sequence, tour)) {
		tourBack()
		return true
	}
	return historyBack()
}
