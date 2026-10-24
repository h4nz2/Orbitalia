import { afterEach, describe, expect, it } from "vitest"

import { dateToJD } from "@/sim"
import { simSearchSchema } from "@/store/simSearch"
import { roundJD } from "@/store/urlSync"

import { freshStartLink, useShareStore, viewLink } from "./shareLink"

afterEach(() => {
	useShareStore.setState(useShareStore.getInitialState(), true)
})

describe("the fresh start's link (#69)", () => {
	it("is the app's address with the language, the reading level and intro=play, and nothing else", () => {
		expect(freshStartLink("https://orbitalia.app", "/", "de", "simple")).toBe(
			"https://orbitalia.app/solar_system?lang=de&reading=simple&intro=play",
		)
		const url = new URL(
			freshStartLink("http://localhost:4173", "/", "en", "standard"),
		)
		expect([...url.searchParams.keys()]).toEqual(["lang", "reading", "intro"])
		// of the simulation's params only the instruction: no view, no time, no presentation
		expect(simSearchSchema.parse(Object.fromEntries(url.searchParams))).toEqual(
			{ intro: "play" },
		)
	})

	it("keeps a sub path the app is served from (VITE_BASE)", () => {
		expect(
			freshStartLink("https://example.org", "/orbitalia/", "cs", "advanced"),
		).toBe(
			"https://example.org/orbitalia/solar_system?lang=cs&reading=advanced&intro=play",
		)
	})
})

describe("the share choice", () => {
	it("starts on this view and holds what the teacher picks", () => {
		expect(useShareStore.getState().kind).toBe("view")
		useShareStore.getState().setKind("fresh")
		expect(useShareStore.getState().kind).toBe("fresh")
	})
})

describe("this view's link (#69)", () => {
	const now = new Date("2026-03-20T09:30:00Z")
	const nowJD = dateToJD(now)
	const live = { simTimeJD: nowJD, timeWarp: 1, paused: false }
	const page = "http://localhost:4173/solar_system"

	it("is the address as it is while the clock shows now, or a birth date hides the time", () => {
		const address = `${page}?focus=jupiter&lang=de`
		expect(viewLink(address, live, false, now)).toBe(address)
		const fast = { ...live, simTimeJD: nowJD + 60, timeWarp: 86400 }
		expect(viewLink(address, fast, true, now)).toBe(address)
	})

	it("pins the moment on screen at a fast clock, where the address keeps the moment it left now", () => {
		// a minute at 1 day/s: the address still says the moment it left now
		const left = roundJD(nowJD)
		const address = `${page}?focus=jupiter&t=${left}&warp=86400&lang=de`
		const fast = { simTimeJD: nowJD + 60, timeWarp: 86400, paused: false }
		const url = new URL(viewLink(address, fast, false, now))
		expect(url.searchParams.get("t")).toBe(String(roundJD(nowJD + 60)))
		// nothing else changes, in the same order
		expect([...url.searchParams.keys()]).toEqual(["focus", "t", "warp", "lang"])
		expect(url.searchParams.get("focus")).toBe("jupiter")
		expect(url.searchParams.get("warp")).toBe("86400")
	})

	it("adds the moment when the address has none yet, and leaves an address already on it alone", () => {
		const paused = { simTimeJD: nowJD - 365, timeWarp: 1, paused: true }
		const url = new URL(viewLink(page, paused, false, now))
		expect(url.searchParams.get("t")).toBe(String(roundJD(nowJD - 365)))
		const address = `${page}?t=${roundJD(nowJD - 365)}&paused=true`
		expect(viewLink(address, paused, false, now)).toBe(address)
	})
})
