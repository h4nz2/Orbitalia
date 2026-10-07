import { beforeEach, describe, expect, it, vi } from "vitest"

import {
	DEFAULT_PREFS,
	SOUND_ON_KEY,
	SOUND_PREFS_KEY,
	parsePrefs,
	useSoundStore,
} from "./sound"

// vitest runs in node: Maps stand in for the browser's storages
const local = new Map<string, string>()
const session = new Map<string, string>()
const storage = (memory: Map<string, string>) => ({
	getItem: (key: string) => memory.get(key) ?? null,
	setItem: (key: string, value: string) => void memory.set(key, value),
	removeItem: (key: string) => void memory.delete(key),
})
vi.stubGlobal("localStorage", storage(local))
vi.stubGlobal("sessionStorage", storage(session))

const sound = () => useSoundStore.getState()

beforeEach(() => {
	local.clear()
	session.clear()
	useSoundStore.setState({
		...DEFAULT_PREFS,
		enabled: false,
		playing: null,
		muted: false,
	})
})

/** A fresh copy of the store module, as a new page load would see it. */
async function reload() {
	vi.resetModules()
	return (await import("./sound")).useSoundStore.getState()
}

describe("useSoundStore", () => {
	it("starts silent on a fresh visit, with quiet defaults", async () => {
		const fresh = await reload()
		expect(fresh.enabled).toBe(false)
		expect(fresh.playing).toBeNull()
		expect(fresh.volume).toBe(0.5)
		expect(fresh.ambient).toBe(true)
		expect(fresh.cues).toBe(true)
	})

	it("remembers 'on' for the tab only, never across visits", async () => {
		sound().setEnabled(true)
		expect(session.get(SOUND_ON_KEY)).toBe("1")
		expect(local.has(SOUND_ON_KEY)).toBe(false)
		expect((await reload()).enabled).toBe(true)
		session.clear() // a new tab or tomorrow's lesson
		expect((await reload()).enabled).toBe(false)
	})

	it("remembers the volume and the layers across visits, without turning sound on", async () => {
		sound().setVolume(0.8)
		sound().setAmbient(false)
		sound().setCues(false)
		const fresh = await reload()
		expect(fresh).toMatchObject({
			volume: 0.8,
			ambient: false,
			cues: false,
			enabled: false,
		})
	})

	it("clamps the volume and ignores non-numbers", () => {
		sound().setVolume(3)
		expect(sound().volume).toBe(1)
		sound().setVolume(-1)
		expect(sound().volume).toBe(0)
		sound().setVolume(Number.NaN)
		expect(sound().volume).toBe(0)
	})

	it("remembers a mute for the visit, so nothing turns sound back on by itself (#52)", async () => {
		expect(sound().muted).toBe(false)
		// never on, so never muted: an Easy hunt may ask for its voice
		sound().setEnabled(false)
		expect(sound().muted).toBe(false)
		sound().setEnabled(true)
		sound().mute()
		expect(sound().muted).toBe(true)
		// the viewer turning it on again clears it
		sound().setEnabled(true)
		expect(sound().muted).toBe(false)
		sound().mute()
		sound().setPlaying("jupiterWhistlers")
		expect(sound().muted).toBe(false)
		// a new page load starts unmuted (and silent)
		sound().mute()
		expect((await reload()).muted).toBe(false)
	})

	it("mute silences everything at once, recordings included", () => {
		sound().setPlaying("jupiterWhistlers")
		expect(sound().enabled).toBe(true)
		sound().mute()
		expect(sound().enabled).toBe(false)
		expect(sound().playing).toBeNull()
		expect(session.has(SOUND_ON_KEY)).toBe(false)
	})

	it("playing a recording turns sound on in one update", () => {
		const seen: [boolean, string | null][] = []
		const off = useSoundStore.subscribe((state) =>
			seen.push([state.enabled, state.playing]),
		)
		sound().setPlaying("saturnRadio")
		off()
		expect(seen).toEqual([[true, "saturnRadio"]])
	})
})

describe("parsePrefs", () => {
	it("falls back to the defaults for missing or malformed storage", () => {
		expect(parsePrefs(null)).toEqual(DEFAULT_PREFS)
		expect(parsePrefs("{nope")).toEqual(DEFAULT_PREFS)
		expect(parsePrefs("null")).toEqual(DEFAULT_PREFS)
		expect(parsePrefs('{"volume":"loud","ambient":1}')).toEqual(DEFAULT_PREFS)
	})

	it("keeps valid fields and clamps the volume", () => {
		expect(
			parsePrefs('{"volume":7,"ambient":false,"cues":true,"enabled":true}'),
		).toEqual({ volume: 1, ambient: false, cues: true })
	})

	it("stores under its own key", () => {
		sound().setVolume(0.25)
		expect(JSON.parse(local.get(SOUND_PREFS_KEY)!)).toEqual({
			volume: 0.25,
			ambient: true,
			cues: true,
		})
	})
})
