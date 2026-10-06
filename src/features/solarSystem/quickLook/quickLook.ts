/**
 * The quick look (#44; docs/ARCHITECTURE.md, "The quick look"): after the
 * opening (#30) hands over on a first visit, the app asks once whether the
 * viewer wants a quick look at what it can do. Yes plays a short tour of five
 * features working in the scene, a step for teachers on presentation mode and
 * a pointer to the help page; no, or no answer, shows nothing further.
 *
 * - Asked once per browser: `orbitalia.quickLookAsked` in local storage, set
 *   when the question appears (an ignored question counts as no). With storage
 *   blocked it is asked at most once per visit.
 * - Never over a shared link or in presentation mode: the opening does not
 *   play over a link, and the question only follows the opening; a teacher
 *   presenting never sees it.
 * - It plays on the tour player (#28): `startQuickLook` starts the tour of
 *   `script.ts`, `watchQuickLook` adds each step's extras (the glowing control,
 *   the flash of light) and takes the viewer back to a calm view when it ends:
 *   Skip, Finish and Escape go back to where they were before (the overview,
 *   now, 1x after the opening); a click on a world to explore keeps that world
 *   but calms the rest (speed, scale, layers, the flash).
 */
import { create } from "zustand"

import { readPreference, writePreference } from "@/i18n/storage"
import { useHudStore } from "@/store/hud"
import { useLightStore } from "@/store/light"
import { usePresentationStore } from "@/store/presentation"
import { useScaleStore } from "@/store/scale"
import { useSimStore } from "@/store/sim"
import {
	TOUR_LAYER_FIELDS,
	useTourStore,
	type TourLayerKey,
} from "@/store/tour"

import { useIntroStore } from "../intro/intro"
import { exitTour, startTour, tourStatus } from "../tours/player"
import {
	QUICK_LOOK_ID,
	quickLookStep,
	quickLookTour,
	type Spot,
} from "./script"

/** Remembered on this device only (never sent anywhere): the question has been asked here. */
export const QUICK_LOOK_ASKED_KEY = "orbitalia.quickLookAsked"

/** An unanswered question goes away after this long, ms (no answer is no). */
export const ASK_TIMEOUT_MS = 30_000

export interface QuickLookState {
	/** The question is on screen. */
	asking: boolean
	/** The control the step on screen points at (glows), while the quick look runs. */
	spot: Spot | null
}

export const useQuickLookStore = create<QuickLookState>()(() => ({
	asking: false,
	spot: null,
}))

// asked in this visit (storage may be blocked: then this is all that remembers it)
let askedThisVisit = false

/** For the tests: a fresh visit. */
export const resetVisit = (): void => {
	askedThisVisit = false
}

export const hasBeenAsked = (): boolean =>
	askedThisVisit || readPreference(QUICK_LOOK_ASKED_KEY) !== null

/** Whether the question may appear now: never asked, not presenting, nothing else playing. */
export function mayAsk(): boolean {
	if (hasBeenAsked()) return false
	if (usePresentationStore.getState().presenting) return false
	if (useTourStore.getState().tour !== null) return false
	return true
}

/** Puts the question on screen (once), and remembers that it was asked. */
export function ask(): boolean {
	if (!mayAsk()) return false
	askedThisVisit = true
	writePreference(QUICK_LOOK_ASKED_KEY, "1")
	useQuickLookStore.setState({ asking: true })
	return true
}

/** The question goes away without an answer (no answer is no). */
export const dismissQuestion = (): void => {
	if (useQuickLookStore.getState().asking)
		useQuickLookStore.setState({ asking: false })
}

/** The viewer's answer: yes plays the quick look, no leaves them to explore. */
export function answer(yes: boolean): void {
	dismissQuestion()
	if (yes) startQuickLook()
}

export const isQuickLook = (tourId: string | null | undefined): boolean =>
	tourId === QUICK_LOOK_ID

/**
 * Plays the quick look from its first step (the question's yes, the Help
 * menu, `?look=play`). It moves on by itself (about a minute); Back, Next and
 * the arrow keys step it, Skip leaves it.
 */
export function startQuickLook(): void {
	dismissQuestion()
	// the dock's panels make way for its card
	useHudStore.getState().setPanel(null)
	startTour(quickLookTour(), { auto: true })
}

/** Skip (or Finish): back to where the viewer was, calm. */
export function leaveQuickLook(): void {
	if (!isQuickLook(useTourStore.getState().tour?.id)) return
	exitTour()
	calmExtras()
}

/** The flash and the glow go with the quick look. */
function calmExtras(): void {
	useQuickLookStore.setState({ spot: null })
	const light = useLightStore.getState()
	if (light.pulse !== null) light.clear()
}

const LAYER_SETTERS = {
	showOrbits: "setShowOrbits",
	showLabels: "setShowLabels",
	showMoons: "setShowMoons",
	showMarkers: "setShowMarkers",
	showOrbitLabels: "setShowOrbitLabels",
	showAllMoons: "setShowAllMoons",
} as const

/**
 * The viewer went off to look at a world of their own: the quick look ends
 * there, keeping that world in view, with the speed, scale and layers back as
 * they were before it began.
 */
function leaveToExplore(): void {
	const { baseline } = useTourStore.getState()
	useTourStore.setState({ tour: null, index: 0, steps: null, baseline: null })
	calmExtras()
	if (baseline === null) return
	const scale = useScaleStore.getState()
	if (baseline.scale !== null && scale.targetId !== baseline.scale)
		scale.switchTo(baseline.scale, performance.now())
	const sim = useSimStore.getState()
	for (const key of Object.keys(TOUR_LAYER_FIELDS) as TourLayerKey[]) {
		const field = TOUR_LAYER_FIELDS[key]
		if (sim[field] !== baseline.layers[key])
			sim[LAYER_SETTERS[field]](baseline.layers[key])
	}
	if (baseline.scene?.atNow === true) {
		sim.setTimeWarp(1)
		sim.setPaused(false)
		sim.setNow()
	} else {
		sim.setTimeWarp(baseline.warp)
		sim.setPaused(baseline.paused)
	}
}

/**
 * Follows the quick look while it plays: each step's glow and flash, and the
 * calm view when it ends by any way (Skip, Finish, Escape, a world clicked,
 * another tour). Also asks the question when a first visit's opening hands
 * over. Returns the function that stops watching.
 */
export function watchQuickLook(): () => void {
	let entered: number | null = null

	const onTour = () => {
		const { tour, index } = useTourStore.getState()
		if (!isQuickLook(tour?.id)) {
			if (entered !== null) {
				entered = null
				calmExtras()
			}
			return
		}
		if (entered === index) return
		entered = index
		const step = quickLookStep(index)
		useQuickLookStore.setState({ spot: step?.spot ?? null })
		const light = useLightStore.getState()
		if (step?.flash !== undefined) light.send(step.flash)
		else if (light.pulse !== null) light.clear()
	}

	// judged once the change is complete: the player itself stops the sequence
	// on its way out (Finish, Skip), and by then the tour is gone
	const onSequence = () =>
		queueMicrotask(() => {
			const tour = useTourStore.getState()
			if (!isQuickLook(tour.tour?.id)) return
			const status = tourStatus(useSimStore.getState().sequence, tour)
			// Escape or the home button: the way out, calm; a world clicked: explore it
			if (status === "left") leaveQuickLook()
			else if (status === "exploring") leaveToExplore()
		})

	const onIntro = (state: { status: string }, previous: { status: string }) => {
		if (previous.status === "playing" && state.status === "handover") ask()
	}

	const stops = [
		useTourStore.subscribe(onTour),
		useSimStore.subscribe((state, previous) => {
			if (state.sequence !== previous.sequence) onSequence()
		}),
		useIntroStore.subscribe(onIntro),
		// a question nobody answers is a no
		useQuickLookStore.subscribe((state, previous) => {
			if (state.asking && !previous.asking) {
				const timer = setTimeout(dismissQuestion, ASK_TIMEOUT_MS)
				const stop = useQuickLookStore.subscribe((next) => {
					if (!next.asking) {
						clearTimeout(timer)
						stop()
					}
				})
			}
		}),
	]
	return () => {
		stops.forEach((stop) => stop())
		dismissQuestion()
		if (isQuickLook(useTourStore.getState().tour?.id)) leaveQuickLook()
		useQuickLookStore.setState({ spot: null })
	}
}
