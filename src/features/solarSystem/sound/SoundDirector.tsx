/**
 * Turns the sound store into audio (#32). Rendered once on the solar system
 * page, renders nothing. It
 * - fades the master in and out with the switch and the volume, and suspends
 *   the audio thread while sound is off or the tab is hidden;
 * - runs the ambient bed while it is wanted, retuned from the camera probe;
 * - plays the cues `watchSoundEvents` reports, when cues are on;
 * - stops a recording once the store no longer names it;
 * - binds the M key (sound on / mute);
 * - after a reload with sound still on for this tab, waits for the first
 *   click or key press before making any sound (autoplay rules, and no
 *   surprises).
 */
import { useEffect } from "react"

import { useSoundStore, type SoundState } from "@/store/sound"

import { hasModifier, isEditableTarget } from "../ui/keyboard"
import {
	AMBIENT_DUCKED,
	AMBIENT_LEVEL,
	getEngine,
	glide,
	suspendAudio,
	unlockAudio,
	type SoundEngine,
} from "./engine"
import { watchSoundEvents, type SoundCues } from "./events"
import { ambientMix, bodyNoteHz, MIN_WHOOSH_MS, volumeGain } from "./mix"
import { playbackId, stopPlayback } from "./player"
import { soundProbe } from "./SoundProbe"
import {
	AmbientBed,
	chime,
	finished,
	found,
	sweep,
	tick,
	whoosh,
	type Voice,
} from "./synth"

/** How often the bed follows the camera, ms. */
const AMBIENT_INTERVAL_MS = 500
/** A turned-off bed keeps its oscillators this long (in case it comes back), ms. */
const AMBIENT_LINGER_MS = 3000
/** After the fade-out, the audio thread stops. */
const SUSPEND_AFTER_MS = 400

/** Sound on or off, from a click or key press (the gesture unlocks audio). */
export function toggleSound(): void {
	const { enabled, setEnabled } = useSoundStore.getState()
	if (enabled) {
		setEnabled(false)
		return
	}
	unlockAudio()
	setEnabled(true)
}

function onKeydown(event: KeyboardEvent): void {
	if (event.key !== "m" && event.key !== "M") return
	if (event.repeat || hasModifier(event) || isEditableTarget(event.target)) {
		return
	}
	toggleSound()
}

declare global {
	interface Window {
		/** Read-only diagnostics for e2e tests: the context's state ("none" before unlock). */
		__orbitaliaSound?: { contextState: () => string }
	}
}

/** Starts everything; returns the teardown. */
function startSound(): () => void {
	let bed: AmbientBed | null = null
	let bedTimer: ReturnType<typeof setTimeout> | undefined
	let suspendTimer: ReturnType<typeof setTimeout> | undefined
	let voice: Voice | null = null

	const cueEngine = (): SoundEngine | null => {
		const { enabled, cues } = useSoundStore.getState()
		const engine = getEngine()
		return enabled && cues && engine?.ctx.state === "running" ? engine : null
	}

	const retuneBed = (seconds?: number) => {
		bed?.set(ambientMix(soundProbe.au), seconds)
	}

	const apply = (state: SoundState, fadeTau = 0.4) => {
		if (state.playing !== playbackId()) stopPlayback()
		const engine = getEngine()
		if (engine === null) return
		const { ctx } = engine
		if (!state.enabled) {
			voice?.stop()
			voice = null
			glide(engine.master.gain, 0, ctx, 0.04)
			clearTimeout(suspendTimer)
			suspendTimer = setTimeout(() => {
				if (!useSoundStore.getState().enabled) suspendAudio()
			}, SUSPEND_AFTER_MS)
			return
		}
		clearTimeout(suspendTimer)
		if (ctx.state === "suspended" && document.visibilityState === "visible") {
			void ctx.resume().catch(() => undefined)
		}
		glide(engine.master.gain, volumeGain(state.volume), ctx, fadeTau)
		if (state.ambient) {
			clearTimeout(bedTimer)
			if (bed === null) {
				bed = new AmbientBed(ctx, engine.ambient)
				retuneBed(0)
				bed.start()
			}
			const level = state.playing !== null ? AMBIENT_DUCKED : AMBIENT_LEVEL
			glide(engine.ambient.gain, level, ctx, 1)
		} else if (bed !== null) {
			glide(engine.ambient.gain, 0, ctx, 0.3)
			clearTimeout(bedTimer)
			bedTimer = setTimeout(() => {
				if (useSoundStore.getState().ambient) return
				bed?.stop()
				bed = null
			}, AMBIENT_LINGER_MS)
		}
	}

	const offStore = useSoundStore.subscribe((state) => apply(state))

	// a tab that had sound on: silent until the viewer's first gesture
	const onGesture = () => {
		const state = useSoundStore.getState()
		if (!state.enabled) return
		const engine = getEngine()
		if (engine !== null && engine.ctx.state === "running") return
		unlockAudio()
		apply(state, 1)
	}
	window.addEventListener("pointerdown", onGesture, true)
	window.addEventListener("keydown", onGesture, true)
	window.addEventListener("keydown", onKeydown)

	const onVisibility = () => {
		if (document.visibilityState === "hidden") suspendAudio()
		else if (useSoundStore.getState().enabled && getEngine() !== null) {
			apply(useSoundStore.getState())
		}
	}
	document.addEventListener("visibilitychange", onVisibility)

	const ambientTimer = setInterval(() => {
		const { enabled, ambient } = useSoundStore.getState()
		if (enabled && ambient) retuneBed()
	}, AMBIENT_INTERVAL_MS)

	const cues: SoundCues = {
		flightStart: (flight) => {
			voice?.stop()
			voice = null
			const engine = cueEngine()
			if (engine === null || flight.durationMs < MIN_WHOOSH_MS) return
			voice = whoosh(
				engine.ctx,
				engine.cues,
				flight.durationMs,
				flight.travelStart,
				flight.travelEnd,
			)
		},
		flightEnd: () => {
			voice?.stop()
			voice = null
		},
		arrived: (bodyId) => {
			const engine = cueEngine()
			if (engine !== null) chime(engine.ctx, engine.cues, bodyNoteHz(bodyId))
		},
		paused: (paused) => {
			const engine = cueEngine()
			if (engine !== null) tick(engine.ctx, engine.cues, !paused)
		},
		timeTravel: (forward, durationMs) => {
			const engine = cueEngine()
			if (engine !== null) sweep(engine.ctx, engine.cues, forward, durationMs)
		},
		found: () => {
			const engine = cueEngine()
			if (engine !== null) found(engine.ctx, engine.cues)
		},
		finished: () => {
			const engine = cueEngine()
			if (engine !== null) finished(engine.ctx, engine.cues)
		},
		lightReached: (bodyId) => {
			const engine = cueEngine()
			if (engine !== null) {
				chime(engine.ctx, engine.cues, bodyNoteHz(bodyId) * 2, {
					gain: 0.12,
					decay: 1.2,
				})
			}
		},
	}
	const offEvents = watchSoundEvents(cues)

	window.__orbitaliaSound = {
		contextState: () => getEngine()?.ctx.state ?? "none",
	}

	// a remount (route change and back) with sound on and audio unlocked
	if (getEngine() !== null) apply(useSoundStore.getState())

	return () => {
		offStore()
		offEvents()
		window.removeEventListener("pointerdown", onGesture, true)
		window.removeEventListener("keydown", onGesture, true)
		window.removeEventListener("keydown", onKeydown)
		document.removeEventListener("visibilitychange", onVisibility)
		clearInterval(ambientTimer)
		clearTimeout(bedTimer)
		clearTimeout(suspendTimer)
		voice?.stop()
		stopPlayback()
		bed?.stop()
		const engine = getEngine()
		if (engine !== null) glide(engine.master.gain, 0, engine.ctx, 0.04)
		suspendAudio()
		delete window.__orbitaliaSound
	}
}

/** The page's sound: mount once, anywhere on the solar system page. */
function SoundDirector() {
	useEffect(startSound, [])
	return null
}

export default SoundDirector
