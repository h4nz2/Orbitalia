/**
 * The gesture hint (#62; docs/ARCHITECTURE.md, "Students first"): on a phone
 * held upright and touched, three things work without a button: dragging the
 * sheet's handle (#60), tapping the sky to hide the controls (#59) and
 * swiping the card to the next world. Every gesture needs a visible hint, so
 * the first time a short card shows all three.
 *
 * - **Once per browser:** `orbitalia.gestureHintShown` in local storage, set
 *   when the hint appears. With storage blocked it shows at most once per
 *   visit.
 * - **When:** where all three can be tried at once: the sheet shows a
 *   world's card, and the scene has been at rest for `REST_MS`. A link's
 *   arrival on a planet or a moon (a student scanning the class QR code) has
 *   no opening and no quick look, so that is soon after it opened; a tour, a
 *   hunt or a tool a link opened comes first, and the hint waits until the
 *   card is back (over the hunt it would leave no room to find the answer,
 *   and there the sky tap hides nothing and there is no card to swipe). A
 *   first visit without a link waits until the opening (#30), its hints and
 *   the quick look (#44) are over, and a world is chosen. Never while
 *   presenting (#29), never with the controls hidden, never on a laptop, a
 *   tablet or a phone on its side.
 * - **Until:** its OK or ×, or one of the gestures it shows (a drag of the
 *   sheet or a tap on its handle, a tap on the sky, a swipe of the card), or
 *   the sheet moving on to something else (a panel, a tour). The tap on the
 *   sky that takes it away does nothing else: it is something a press closes
 *   (`present/skyTap.ts`), like an open menu.
 */
import { create } from "zustand"

import { readPreference, writePreference } from "@/i18n/storage"
import { useHudStore } from "@/store/hud"
import { usePresentationStore } from "@/store/presentation"
import { useSheetStore } from "@/store/sheet"
import { useTourStore } from "@/store/tour"
import { isTouch, isUprightPhone } from "@/utils/sizeClasses"

import { useIntroStore } from "../intro/intro"
import { isQuickLook, useQuickLookStore } from "../quickLook/quickLook"

/** Remembered on this device only (never sent anywhere): the hint has been shown here. */
export const GESTURE_HINT_KEY = "orbitalia.gestureHintShown"

/** How long the scene stays at rest before the hint appears, ms. */
export const REST_MS = 2000

export interface GestureHintState {
	/** The hint is on screen. */
	showing: boolean
}

export const useGestureHintStore = create<GestureHintState>()(() => ({
	showing: false,
}))

// shown in this visit (storage may be blocked: then this is all that remembers it)
let shownThisVisit = false

/** For the tests: a fresh visit. */
export const resetGestureHintVisit = (): void => {
	shownThisVisit = false
}

export const gestureHintShown = (): boolean =>
	shownThisVisit || readPreference(GESTURE_HINT_KEY) !== null

/** What decides whether the hint may appear now. */
export interface GestureHintContext {
	/** A phone held upright, with a finger as its pointer: the gestures exist. */
	uprightTouch: boolean
	presenting: boolean
	/** The controls are hidden (#59): the hint would show with nothing it names. */
	hidden: boolean
	/** The opening plays (#30), or its hints on how to move around are up. */
	opening: boolean
	/** The quick look (#44) asks or plays. */
	quickLook: boolean
	/** The scene has drawn: the page is no longer loading. */
	sceneOn: boolean
	/** The sheet shows a world's card: the three moves can be tried right there. */
	world: boolean
	/** The camera moves, or the sheet is being dragged. */
	moving: boolean
}

/** Whether the hint may appear now (it has never been shown). Pure but for the storage. */
export const mayShowGestureHint = (context: GestureHintContext): boolean =>
	context.uprightTouch &&
	!context.presenting &&
	!context.hidden &&
	!context.opening &&
	!context.quickLook &&
	context.sceneOn &&
	context.world &&
	!context.moving &&
	!gestureHintShown()

const currentContext = (): GestureHintContext => {
	const intro = useIntroStore.getState()
	const hud = useHudStore.getState()
	return {
		uprightTouch: isUprightPhone() && isTouch(),
		presenting: usePresentationStore.getState().presenting,
		hidden: usePresentationStore.getState().chromeHidden,
		opening: intro.status === "playing" || intro.hints,
		quickLook:
			useQuickLookStore.getState().asking ||
			isQuickLook(useTourStore.getState().tour?.id),
		sceneOn: hud.sceneOn,
		world: useSheetStore.getState().world,
		moving: hud.cameraMoving || useSheetStore.getState().dragging,
	}
}

/** Puts the hint on screen (once), and remembers that it was shown. */
export function showGestureHint(): boolean {
	if (!mayShowGestureHint(currentContext())) return false
	shownThisVisit = true
	writePreference(GESTURE_HINT_KEY, "1")
	useGestureHintStore.setState({ showing: true })
	return true
}

/**
 * The hint goes away: its OK or ×, or the viewer used one of its gestures.
 * Returns whether it was on screen.
 */
export function dismissGestureHint(): boolean {
	if (!useGestureHintStore.getState().showing) return false
	useGestureHintStore.setState({ showing: false })
	return true
}

/**
 * Shows the hint once a world's card is in the sheet and the scene has been
 * at rest for `REST_MS`, and takes it away when its moment has passed
 * (presenting, the controls hidden, the opening or the quick look starting,
 * the card making way, a drag of the sheet). Returns the function that stops
 * watching (and takes the hint away with the page).
 */
export function watchGestureHint(): () => void {
	let timer: ReturnType<typeof setTimeout> | null = null
	const clearTimer = () => {
		if (timer !== null) clearTimeout(timer)
		timer = null
	}
	const check = () => {
		if (useGestureHintStore.getState().showing) {
			const context = currentContext()
			if (
				context.presenting ||
				context.hidden ||
				context.opening ||
				context.quickLook ||
				!context.world ||
				useSheetStore.getState().dragging
			)
				dismissGestureHint()
			return
		}
		// every change starts the wait again: the scene must stay at rest for all of it
		clearTimer()
		if (!mayShowGestureHint(currentContext())) return
		timer = setTimeout(() => {
			timer = null
			showGestureHint()
		}, REST_MS)
	}
	const stops = [
		useHudStore.subscribe((state, previous) => {
			if (
				state.cameraMoving !== previous.cameraMoving ||
				state.sceneOn !== previous.sceneOn
			)
				check()
		}),
		useSheetStore.subscribe((state, previous) => {
			if (
				state.dragging !== previous.dragging ||
				state.world !== previous.world
			)
				check()
		}),
		usePresentationStore.subscribe((state, previous) => {
			if (
				state.presenting !== previous.presenting ||
				state.chromeHidden !== previous.chromeHidden
			)
				check()
		}),
		useIntroStore.subscribe(check),
		useQuickLookStore.subscribe(check),
		useTourStore.subscribe((state, previous) => {
			if (state.tour !== previous.tour) check()
		}),
		useGestureHintStore.subscribe(check),
	]
	check()
	return () => {
		stops.forEach((stop) => stop())
		clearTimer()
		dismissGestureHint()
	}
}
