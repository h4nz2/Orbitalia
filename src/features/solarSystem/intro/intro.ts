/**
 * The opening sequence's state and cues (#30, docs/ARCHITECTURE.md, "The
 * first ten seconds").
 *
 * The camera part is an ordinary `playSequence` (./script.ts), so everything
 * that interrupts a sequence ends the opening at once: a drag, a wheel or a
 * pinch, a click on a body, the picker, Escape, the home button, or the Skip
 * button. The scale is the one cue a camera sequence cannot carry: the
 * pull-back is drawn in true scale, and the last beat (or any early end)
 * switches to Everything visible. A scale the viewer picked mid-way is theirs
 * and is kept.
 *
 * Status: `off` (nothing to show), `playing` (the sequence runs; captions and
 * the Skip button are up), `handover` (it ended; the hints fade and Earth
 * pulses until the viewer does something).
 */
import { create } from "zustand"

import { readPreference, writePreference } from "@/i18n/storage"
import type { SequenceStep } from "@/store/navigation"
import { useScaleStore } from "@/store/scale"
import { useSimStore, type SimState } from "@/store/sim"
import type { SimSearch } from "@/store/simSearch"

import {
	HANDOVER_SCALE,
	INTRO_SCALE,
	SCALE_BEAT,
	SCALE_REVEAL_MS,
	hasExplicitView,
	introSteps,
	sunlitAzimuthDeg,
} from "./script"

/**
 * Remembered on this device only (never sent anywhere): the opening has been
 * shown here, so a returning visitor goes straight to the overview.
 */
export const INTRO_SEEN_KEY = "orbitalia.introSeen"

/** How a scale left in true scale by an interrupted opening goes back to the default, ms. */
export const RESTORE_SCALE_MS = 1000

export type IntroStatus = "off" | "playing" | "handover"

/** How the opening ended: it ran to the end, or the viewer took over (and how). */
export type IntroEnd = "done" | "stopped" | "interrupted" | "userScale"

export interface IntroState {
	status: IntroStatus
	/** The running opening's steps (identifies its sequence in the store). */
	steps: readonly SequenceStep[] | null
	/** The beat on screen (index into `INTRO_BEATS`). */
	beat: number
	reducedMotion: boolean
	/** How the last opening ended, while handing over. */
	ended: IntroEnd | null
	/** Earth pulses "click me" (handover, until the viewer picks something). */
	pulse: boolean
	/** The hints on how to move around are up (they fade by themselves). */
	hints: boolean
}

export const useIntroStore = create<IntroState>()(() => ({
	status: "off",
	steps: null,
	beat: 0,
	reducedMotion: false,
	ended: null,
	pulse: false,
	hints: false,
}))

export const prefersReducedMotion = (): boolean =>
	typeof window !== "undefined" &&
	typeof window.matchMedia === "function" &&
	window.matchMedia("(prefers-reduced-motion: reduce)").matches

export const hasSeenIntro = (): boolean =>
	readPreference(INTRO_SEEN_KEY) !== null

/**
 * The opening plays on arrival only for a first visit on this device, and
 * only when the link does not say where to look: a shared view opens exactly
 * where it was taken.
 */
export const shouldPlayOnArrival = (search: Partial<SimSearch>): boolean =>
	!hasExplicitView(search) && !hasSeenIntro()

// true while the opening itself changes the scale, so the watcher can tell the viewer's own choice
let ownScaleChange = false
const withOwnScale = (change: () => void) => {
	ownScaleChange = true
	try {
		change()
	} finally {
		ownScaleChange = false
	}
}

/**
 * Plays the opening from the start (first visit, or "Play the opening again"):
 * back to a known state (overview, Sun-centred, nothing selected), true scale,
 * then the sequence. Marks the opening as seen on this device.
 */
export function startIntro(): void {
	if (useIntroStore.getState().status === "playing") return
	const reducedMotion = prefersReducedMotion()
	const sim = useSimStore.getState()
	sim.reset()
	const steps = introSteps({
		earthAzimuthDeg: sunlitAzimuthDeg(sim.simTimeJD),
		reducedMotion,
	})
	useIntroStore.setState({
		status: "playing",
		steps,
		beat: 0,
		reducedMotion,
		ended: null,
		pulse: false,
		hints: false,
	})
	withOwnScale(() => useScaleStore.getState().setPreset(INTRO_SCALE))
	useSimStore.getState().playSequence(steps)
	writePreference(INTRO_SEEN_KEY, "1")
}

/** Ends the opening and hands over: the default scale, the hints, and Earth pulsing. */
export function endIntro(how: IntroEnd, now: number = performance.now()): void {
	const intro = useIntroStore.getState()
	if (intro.status !== "playing") return
	// first, so the store changes below never end it a second time
	useIntroStore.setState({
		status: "handover",
		steps: null,
		ended: how,
		pulse: false,
		hints: true,
	})
	const sim = useSimStore.getState()
	if (sim.sequence !== null && sim.sequence.steps === intro.steps) {
		sim.stopSequence()
	}
	if (how !== "userScale") {
		const scale = useScaleStore.getState()
		if (scale.targetId !== HANDOVER_SCALE) {
			// a viewer who grabbed the camera sees the planets grow back; Skip and Escape just land
			const ms =
				how === "interrupted" && !intro.reducedMotion ? RESTORE_SCALE_MS : 0
			withOwnScale(() => scale.switchTo(HANDOVER_SCALE, now, ms))
		}
	}
	// a viewer who already picked a body has found out what a click does
	const state = useSimStore.getState()
	if (state.selectedId === null && state.view.kind === "overview") {
		useIntroStore.setState({ pulse: true })
	}
}

/** The Skip button: straight to the end (the overview, Everything visible). */
export function skipIntro(): void {
	const intro = useIntroStore.getState()
	if (intro.status !== "playing") return
	const sim = useSimStore.getState()
	// skip() lands on the last stop and ends the sequence; the watcher then hands over
	if (sim.sequence !== null && sim.sequence.steps === intro.steps) sim.skip()
	else endIntro("stopped")
}

/** Leaving the page: nothing of the opening survives. */
export function cancelIntro(): void {
	const intro = useIntroStore.getState()
	const sim = useSimStore.getState()
	if (sim.sequence !== null && sim.sequence.steps === intro.steps) {
		sim.stopSequence()
	}
	useIntroStore.setState({
		status: "off",
		steps: null,
		beat: 0,
		ended: null,
		pulse: false,
		hints: false,
	})
}

/** "Show how to move around": the hints again, without the opening. */
export function showHints(): void {
	const { status } = useIntroStore.getState()
	if (status === "playing") return
	useIntroStore.setState({ status: "handover", hints: true })
}

/** The hints have faded. */
export const hideHints = (): void => {
	if (useIntroStore.getState().hints) useIntroStore.setState({ hints: false })
}

/** Stops Earth's pulse (the viewer picked something, or it has pulsed long enough). */
export const stopPulse = (): void => {
	if (useIntroStore.getState().pulse) useIntroStore.setState({ pulse: false })
}

/** The watcher's reaction to a change of the simulation store. */
export function onSimChange(
	state: Pick<SimState, "sequence" | "transition" | "selectedId" | "view">,
	previous: Pick<SimState, "sequence" | "transition">,
	now: number = performance.now(),
): void {
	const intro = useIntroStore.getState()
	if (intro.status === "handover") {
		if (
			intro.pulse &&
			(state.selectedId !== null || state.view.kind !== "overview")
		) {
			stopPulse()
		}
		return
	}
	if (intro.status !== "playing" || intro.steps === null) return
	const { sequence } = state
	if (sequence !== null && sequence.steps === intro.steps) {
		if (sequence.phase === "interrupted") {
			endIntro("interrupted", now)
			return
		}
		if (sequence.index !== intro.beat) {
			useIntroStore.setState({ beat: sequence.index })
			if (sequence.index === SCALE_BEAT) {
				const ms = intro.reducedMotion ? 0 : SCALE_REVEAL_MS
				withOwnScale(() =>
					useScaleStore.getState().switchTo(HANDOVER_SCALE, now, ms),
				)
			}
		}
		return
	}
	// not started yet (playSequence sets the view before the sequence)
	const last = previous.sequence
	if (last === null || last.steps !== intro.steps) return
	// the sequence is gone: its last hold ran out, or something else ended it
	const ranOut =
		sequence === null &&
		last.index === intro.steps.length - 1 &&
		last.phase === "holding" &&
		state.transition === previous.transition
	endIntro(ranOut ? "done" : "stopped", now)
}

/** Installs the watchers; returns the function that removes them. */
export function watchIntro(): () => void {
	const unsubscribeSim = useSimStore.subscribe((state, previous) =>
		onSimChange(state, previous),
	)
	const unsubscribeScale = useScaleStore.subscribe((state, previous) => {
		if (
			!ownScaleChange &&
			state.targetId !== previous.targetId &&
			useIntroStore.getState().status === "playing"
		) {
			endIntro("userScale")
		}
	})
	return () => {
		unsubscribeSim()
		unsubscribeScale()
	}
}
