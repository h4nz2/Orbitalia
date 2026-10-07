import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useSoundStore } from "@/store/sound"

import { pickVoice, speak, stopSpeaking, type VoiceLike } from "./speech"

const voice = (
	lang: string,
	name = lang,
	extra: Partial<VoiceLike> = {},
): VoiceLike => ({ lang, name, ...extra })

describe("pickVoice: which of the browser's voices reads the clues (#52)", () => {
	it("is none without voices, or without one for the language", () => {
		expect(pickVoice([], "de")).toBeNull()
		expect(pickVoice([voice("en-US"), voice("fr-FR")], "de")).toBeNull()
		// a language that only starts the same is another language
		expect(pickVoice([voice("de-DE")], "")).toBeNull()
	})

	it("takes a voice of the language on screen", () => {
		const german = voice("de-DE")
		expect(pickVoice([voice("en-US"), german, voice("cs-CZ")], "de")).toBe(
			german,
		)
		expect(pickVoice([voice("cs-CZ", "Zuzana")], "cs")?.name).toBe("Zuzana")
	})

	it("reads Android's and odd spellings of the tag", () => {
		const czech = voice("cs_CZ")
		expect(pickVoice([czech], "cs")).toBe(czech)
		const french = voice("FR-fr")
		expect(pickVoice([voice("en-GB"), french], "fr")).toBe(french)
	})

	it("prefers the viewer's own region, in the order of their languages", () => {
		const voices = [voice("de-DE"), voice("de-AT"), voice("de-CH")]
		expect(pickVoice(voices, "de", ["de-CH", "de", "en"])).toBe(voices[2])
		expect(pickVoice(voices, "de", ["de-AT", "de-CH"])).toBe(voices[1])
		// an app locale with a region names it first
		expect(pickVoice(voices, "de-AT", ["de-CH"])).toBe(voices[1])
		// other languages in the list do not count
		expect(pickVoice(voices, "de", ["en-CH"])).toBe(voices[0])
	})

	it("then the browser's default voice, then one on the device", () => {
		const remote = voice("es-ES", "remote")
		const local = voice("es-MX", "local", { localService: true })
		const preferred = voice("es-US", "default", { default: true })
		expect(pickVoice([remote, local], "es")).toBe(local)
		expect(pickVoice([remote, local, preferred], "es")).toBe(preferred)
		// the viewer's region still beats the default
		expect(pickVoice([remote, local, preferred], "es", ["es-ES"])).toBe(remote)
	})

	it("keeps the first listed among equals", () => {
		const a = voice("fr-FR", "a")
		const b = voice("fr-FR", "b")
		expect(pickVoice([a, b], "fr")).toBe(a)
	})
})

describe("speak: the voice is part of the app's sound (#32)", () => {
	const spoken: string[] = []
	let cancelled = 0

	beforeEach(() => {
		spoken.length = 0
		cancelled = 0
		vi.stubGlobal("window", {
			speechSynthesis: {
				speak: (utterance: { text: string }) => spoken.push(utterance.text),
				cancel: () => {
					cancelled++
				},
				getVoices: () => [],
				addEventListener: () => undefined,
				removeEventListener: () => undefined,
			},
		})
		vi.stubGlobal(
			"SpeechSynthesisUtterance",
			class {
				text: string
				voice: unknown = null
				lang = ""
				rate = 1
				constructor(text: string) {
					this.text = text
				}
				addEventListener() {}
			},
		)
		useSoundStore.setState({ enabled: false, muted: false, playing: null })
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		useSoundStore.setState({ enabled: false, muted: false, playing: null })
	})

	const german = { lang: "de-DE", name: "Anna" } as SpeechSynthesisVoice

	it("stays silent while sound is off", () => {
		expect(speak("Finde den Mond!", german)).toBe(false)
		expect(spoken).toEqual([])
	})

	it("reads while sound is on, and muting stops it at once", () => {
		useSoundStore.setState({ enabled: true })
		expect(speak("Finde den Mond!", german)).toBe(true)
		expect(spoken).toEqual(["Finde den Mond!"])
		const before = cancelled
		useSoundStore.getState().mute()
		expect(cancelled).toBeGreaterThan(before)
		expect(useSoundStore.getState().muted).toBe(true)
		stopSpeaking()
	})
})
