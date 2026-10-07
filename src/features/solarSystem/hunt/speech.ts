/**
 * Reading aloud (#52): the hunt's clues, hints and discoveries spoken by the
 * browser's own voices (Web Speech API, `speechSynthesis`) in the language on
 * screen, so a child who cannot read yet can play. No voice for the language
 * (or no speech at all): the speaker buttons are hidden, nothing else changes.
 *
 * The voice is part of the app's sound (#32), never a way around it: it
 * speaks only while sound is on, and muting (the speaker, M) stops it at
 * once. Pressing a speaker button is asking for sound, like Listen; starting
 * an Easy hunt by a click asks for it too, unless the viewer turned sound off
 * in this visit. Every word read is also on screen.
 */
import { useMemo, useSyncExternalStore } from "react"

import { useSoundStore } from "@/store/sound"

import { unlockAudio } from "../sound/engine"

/** What `pickVoice` reads of a voice (`SpeechSynthesisVoice`). */
export interface VoiceLike {
	readonly lang: string
	readonly name: string
	readonly default?: boolean
	readonly localService?: boolean
}

/** A little slower than the default: the listeners are learning to read. */
export const SPEECH_RATE = 0.9

/** "de_DE" (Android) and "de-de" read as "de-DE"'s lowercase. */
const normalizeTag = (tag: string): string =>
	tag.trim().replace(/_/g, "-").toLowerCase()

const languageOf = (tag: string): string => normalizeTag(tag).split("-")[0]

/**
 * The voice to read `locale` (a language of the app, "de", or a full tag)
 * with, or null when the browser has none for that language. Among that
 * language's voices: one for the exact tag first (the locale's own region,
 * then the browser's languages in order: "de-CH" for a Swiss viewer), then
 * the browser's default voice, then one on the device (it works offline and
 * starts at once), then the first listed.
 */
export function pickVoice<V extends VoiceLike>(
	voices: readonly V[],
	locale: string,
	preferred: readonly string[] = [],
): V | null {
	const language = languageOf(locale)
	if (language === "") return null
	const tags = [locale, ...preferred]
		.map(normalizeTag)
		.filter((tag) => tag.includes("-") && languageOf(tag) === language)
	let best: V | null = null
	let bestScore = -1
	for (const voice of voices) {
		const tag = normalizeTag(voice.lang)
		if (languageOf(tag) !== language) continue
		const rank = tags.indexOf(tag)
		const score =
			(rank < 0 ? 0 : tags.length - rank) * 4 +
			(voice.default === true ? 2 : 0) +
			(voice.localService === true ? 1 : 0)
		if (score > bestScore) {
			best = voice
			bestScore = score
		}
	}
	return best
}

const synth = (): SpeechSynthesis | null =>
	typeof window !== "undefined" &&
	"speechSynthesis" in window &&
	typeof SpeechSynthesisUtterance !== "undefined"
		? window.speechSynthesis
		: null

const NO_VOICES: readonly SpeechSynthesisVoice[] = []
let voices: readonly SpeechSynthesisVoice[] = NO_VOICES

/** The voices as a stable list: `getVoices()` returns a new array on every call. */
function voicesSnapshot(): readonly SpeechSynthesisVoice[] {
	const list = synth()?.getVoices() ?? NO_VOICES
	if (
		list.length !== voices.length ||
		list.some((voice, i) => voice !== voices[i])
	) {
		voices = list.length === 0 ? NO_VOICES : list
	}
	return voices
}

/** Voices load after the page (Chrome): `voiceschanged` says when. */
function subscribeVoices(onChange: () => void): () => void {
	const speech = synth()
	if (speech === null) return () => undefined
	speech.addEventListener("voiceschanged", onChange)
	return () => speech.removeEventListener("voiceschanged", onChange)
}

const browserLanguages = (): readonly string[] =>
	typeof navigator === "undefined" ? [] : (navigator.languages ?? [])

/** The voice for `locale`, or null (then nothing offers to read aloud). */
export function useVoice(locale: string): SpeechSynthesisVoice | null {
	const list = useSyncExternalStore(
		subscribeVoices,
		voicesSnapshot,
		() => NO_VOICES,
	)
	return useMemo(
		() => pickVoice(list, locale, browserLanguages()),
		[list, locale],
	)
}

// what is being read right now, for the speaker buttons (pressed while reading)
let spoken: string | null = null
const listeners = new Set<() => void>()
const setSpoken = (text: string | null) => {
	if (spoken === text) return
	spoken = text
	for (const listener of listeners) listener()
}

/** The text being read aloud, or null. */
export const useSpoken = (): string | null =>
	useSyncExternalStore(
		(onChange) => {
			listeners.add(onChange)
			return () => listeners.delete(onChange)
		},
		() => spoken,
		() => null,
	)

/** Stops reading at once. */
export function stopSpeaking(): void {
	synth()?.cancel()
	setSpoken(null)
}

/**
 * Reads `text` aloud with `voice`, replacing whatever is being read. Only
 * while sound is on (#32); returns whether it started.
 */
export function speak(text: string, voice: SpeechSynthesisVoice): boolean {
	const speech = synth()
	if (speech === null || text === "" || !useSoundStore.getState().enabled) {
		return false
	}
	try {
		speech.cancel()
		const utterance = new SpeechSynthesisUtterance(text)
		utterance.voice = voice
		utterance.lang = voice.lang
		utterance.rate = SPEECH_RATE
		const done = () => {
			if (spoken === text) setSpoken(null)
		}
		utterance.addEventListener("end", done)
		utterance.addEventListener("error", done)
		setSpoken(text)
		speech.speak(utterance)
		return true
	} catch {
		// a browser that refuses (a voice gone, speech blocked): the words are on screen
		setSpoken(null)
		return false
	}
}

/** Sound on from a click (the gesture unlocks audio, #32). */
function soundOn(): void {
	const sound = useSoundStore.getState()
	if (sound.enabled) return
	unlockAudio()
	sound.setEnabled(true)
}

/** A speaker button: asking to hear it is asking for sound (like Listen, #32). */
export function speakOnRequest(
	text: string,
	voice: SpeechSynthesisVoice,
): void {
	soundOn()
	speak(text, voice)
}

/**
 * An Easy hunt started by a click asks for the voice (and with it the
 * find's chime): sound on, unless the viewer turned it off in this visit.
 */
export function askForVoice(): void {
	if (useSoundStore.getState().muted) return
	soundOn()
}

// muting (#32) stops the voice at once
useSoundStore.subscribe((state, previous) => {
	if (previous.enabled && !state.enabled) stopSpeaking()
})
