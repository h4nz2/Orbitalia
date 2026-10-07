/**
 * One gentle nudge towards the walk (#48; docs/ARCHITECTURE.md, "The walk's
 * ways in"): the first time a viewer switches to True scale themselves and the
 * planets vanish, a short tip says where they went and points at the
 * basketball walk (#25), the lesson that makes those distances graspable.
 *
 * - Once per browser: `orbitalia.walkNudgeShown` in local storage, set when
 *   the tip appears. With storage blocked it shows at most once per visit.
 * - Only for the viewer's own switch (the Scale panel, the S key), never for a
 *   tour, the quick look, the opening or a link; never while presenting (#29)
 *   or while a tour or the quick look talks in the dock.
 * - It goes away by itself: on its close button, after `NUDGE_TIMEOUT_MS`,
 *   when the scale leaves True scale, when presenting or a tour starts, and
 *   when the page is left. It is never a panel of its own on the scene (#42).
 */
import { create } from "zustand"

import { readPreference, writePreference } from "@/i18n/storage"
import type { ScalePresetId } from "@/sim"
import { usePresentationStore } from "@/store/presentation"
import { useScaleStore } from "@/store/scale"
import { useTourStore } from "@/store/tour"

/** Remembered on this device only (never sent anywhere): the tip has been shown here. */
export const WALK_NUDGE_KEY = "orbitalia.walkNudgeShown"

/** The tip goes away by itself after this long, ms. */
export const NUDGE_TIMEOUT_MS = 20_000

export interface WalkNudgeState {
	/** The tip is on screen. */
	showing: boolean
}

export const useWalkNudgeStore = create<WalkNudgeState>()(() => ({
	showing: false,
}))

// shown in this visit (storage may be blocked: then this is all that remembers it)
let shownThisVisit = false

/** For the tests: a fresh visit. */
export const resetNudgeVisit = (): void => {
	shownThisVisit = false
}

export const nudgeShown = (): boolean =>
	shownThisVisit || readPreference(WALK_NUDGE_KEY) !== null

/** Whether the tip may appear now: never shown, not presenting, no tour talking. */
export function mayNudge(): boolean {
	if (nudgeShown()) return false
	if (usePresentationStore.getState().presenting) return false
	if (useTourStore.getState().tour !== null) return false
	return true
}

/**
 * The viewer chose `presetId` themselves: on their first switch to True
 * scale the tip appears (once), and is remembered. Returns whether it did.
 */
export function nudgeTowardsWalk(presetId: ScalePresetId): boolean {
	if (presetId !== "trueScale" || !mayNudge()) return false
	shownThisVisit = true
	writePreference(WALK_NUDGE_KEY, "1")
	useWalkNudgeStore.setState({ showing: true })
	return true
}

/** The tip goes away (its close button, a timeout, the scene moving on). */
export const dismissWalkNudge = (): void => {
	if (useWalkNudgeStore.getState().showing)
		useWalkNudgeStore.setState({ showing: false })
}

/**
 * Takes the tip away again when its moment has passed: after a while, when the
 * scale leaves True scale, when presenting or a tour starts. Returns the
 * function that stops watching (and takes the tip away with the page).
 */
export function watchWalkNudge(): () => void {
	let timer: ReturnType<typeof setTimeout> | null = null
	const clearTimer = () => {
		if (timer !== null) clearTimeout(timer)
		timer = null
	}
	const stops = [
		useWalkNudgeStore.subscribe((state, previous) => {
			if (state.showing === previous.showing) return
			clearTimer()
			if (state.showing) timer = setTimeout(dismissWalkNudge, NUDGE_TIMEOUT_MS)
		}),
		useScaleStore.subscribe((state) => {
			if (state.targetId !== "trueScale") dismissWalkNudge()
		}),
		usePresentationStore.subscribe((state) => {
			if (state.presenting) dismissWalkNudge()
		}),
		useTourStore.subscribe((state) => {
			if (state.tour !== null) dismissWalkNudge()
		}),
	]
	return () => {
		stops.forEach((stop) => stop())
		clearTimer()
		dismissWalkNudge()
	}
}
