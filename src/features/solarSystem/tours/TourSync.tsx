/**
 * The tour's side effects on the page (#28), in an empty component so none
 * of them re-renders the HUD: a link opening on a stop (`?tour=<id>&stop=<n>`),
 * keeping the tour in step with its camera sequence, autoplay, and the keys a
 * presenter uses (arrows and a clicker's Page Up / Page Down).
 *
 * Render it after the URL sync (index.tsx): its layout effect then runs after
 * the URL has seeded the store, and the tour's stop wins over the rest of the link.
 */
import { useEffect, useLayoutEffect, useRef } from "react"
import { useSearch } from "@tanstack/react-router"

import { eventOfTourId } from "@/data/skyEvents"
import { tourById } from "@/data/tours"
import { useSimStore } from "@/store/sim"
import { useTourStore } from "@/store/tour"

import { startEvent } from "../events/player"
import { EVENT_VIEWS } from "../events/staging"
import {
	hasModifier,
	isArrowWidgetTarget,
	isEditableTarget,
} from "../ui/keyboard"
import { autoHoldMs } from "./plan"
import {
	exitTour,
	followSequence,
	nextStop,
	previousStop,
	startTour,
	tourStatus,
} from "./player"
import { useTourWords } from "./text"

/** Keys that step a running tour: arrows, and what presenter clickers send. */
export const TOUR_KEYS: Readonly<Record<string, "next" | "back">> = {
	ArrowRight: "next",
	PageDown: "next",
	ArrowLeft: "back",
	PageUp: "back",
}

/**
 * Steps the tour on a presenter key. Listens in the capture phase so, while a
 * tour runs, the arrows step it instead of cycling the focus between bodies.
 */
function onTourKey(event: KeyboardEvent): void {
	const action = TOUR_KEYS[event.key]
	if (action === undefined || useTourStore.getState().tour === null) return
	if (
		hasModifier(event) ||
		event.shiftKey ||
		isEditableTarget(event.target) ||
		isArrowWidgetTarget(event.target)
	) {
		return
	}
	event.preventDefault()
	event.stopImmediatePropagation()
	if (action === "next") nextStop()
	else previousStop()
}

/** Autoplay: at a stop the camera has reached, moves on once its narration has had time; a look around restarts the wait. */
function useAutoAdvance(): void {
	const auto = useTourStore((state) => state.auto)
	const tour = useTourStore((state) => state.tour)
	const index = useTourStore((state) => state.index)
	const words = useTourWords()

	useEffect(() => {
		if (!auto || tour === null || index >= tour.stops.length - 1) return
		const stop = tour.stops[index]
		const holdMs = autoHoldMs(stop, words.stop(tour, stop).text)
		let timer: ReturnType<typeof setTimeout> | undefined
		const arm = () => {
			if (timer !== undefined) clearTimeout(timer)
			timer = undefined
			const { sequence } = useSimStore.getState()
			const waiting =
				tourStatus(sequence, useTourStore.getState()) === "playing" &&
				sequence?.phase === "waiting"
			if (waiting) timer = setTimeout(nextStop, holdMs)
		}
		arm()
		const unsubscribe = useSimStore.subscribe((state, previous) => {
			if (
				state.sequence !== previous.sequence ||
				state.shot !== previous.shot
			) {
				arm()
			}
		})
		return () => {
			unsubscribe()
			if (timer !== undefined) clearTimeout(timer)
		}
	}, [auto, tour, index, words])
}

const TourSync = () => {
	const search = useSearch({ from: "/solar_system" })
	// the link as the page opened with it (the URL sync rewrites it right away)
	const opening = useRef(search)

	useLayoutEffect(() => {
		const { tour, stop, autoplay } = opening.current
		const event = tour === undefined ? null : eventOfTourId(tour)
		if (event !== null) {
			// a sky event's link (#41): its view counted from 1
			startEvent(event.id, {
				view: EVENT_VIEWS[(stop ?? 1) - 1] ?? "space",
				jump: true,
			})
		} else if (tour !== undefined && tourById.has(tour)) {
			startTour(tour, {
				startAt: (stop ?? 1) - 1,
				auto: autoplay === true,
				jump: true,
			})
		} else if (useTourStore.getState().tour !== null) {
			// a tour left running when the page was last closed ends here, not on
			// unmount, where writing the URL could pull the visitor back to this page
			exitTour()
		}
		return followSequence()
	}, [])

	useEffect(() => {
		window.addEventListener("keydown", onTourKey, { capture: true })
		return () =>
			window.removeEventListener("keydown", onTourKey, { capture: true })
	}, [])

	useAutoAdvance()
	return null
}

export default TourSync
