import { afterEach, describe, expect, it } from "vitest"

import { simSearchSchema } from "@/store/simSearch"

import { freshStartLink, useShareStore } from "./shareLink"

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
