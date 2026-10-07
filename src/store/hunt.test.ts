import { beforeEach, describe, expect, it, vi } from "vitest"

import { HUNT_STORAGE_KEY, parseProgress, useHuntStore } from "./hunt"

// vitest runs in node: a Map stands in for the tab's sessionStorage
const memory = new Map<string, string>()
vi.stubGlobal("sessionStorage", {
	getItem: (key: string) => memory.get(key) ?? null,
	setItem: (key: string, value: string) => void memory.set(key, value),
	removeItem: (key: string) => void memory.delete(key),
})

const reset = () => {
	useHuntStore.setState({
		key: null,
		step: 0,
		hints: 0,
		phase: "asking",
		found: [],
		open: false,
		collapsed: false,
		choosing: false,
		guess: null,
		difficulty: null,
		assist: false,
	})
}

describe("useHuntStore", () => {
	beforeEach(reset)

	it("starts a hunt on its first clue, open", () => {
		useHuntStore.getState().start("firstSteps")
		const state = useHuntStore.getState()
		expect(state).toMatchObject({
			key: "firstSteps",
			step: 0,
			hints: 0,
			phase: "asking",
			found: [],
			open: true,
		})
	})

	it("counts hints up to what the clue has, and nothing else", () => {
		const store = useHuntStore.getState()
		store.start("firstSteps")
		store.hint(2)
		store.hint(2)
		store.hint(2)
		expect(useHuntStore.getState().hints).toBe(2)
		store.solve("moon")
		store.next()
		// a new clue starts without hints; nothing remembers how many were used
		expect(useHuntStore.getState()).toMatchObject({
			step: 1,
			hints: 0,
			phase: "asking",
			found: ["moon"],
		})
	})

	it("solves a clue once and moves on only from a solved clue", () => {
		const store = useHuntStore.getState()
		store.start("firstSteps")
		store.next()
		expect(useHuntStore.getState().step).toBe(0)
		store.solve("moon")
		store.solve("mars")
		expect(useHuntStore.getState().found).toEqual(["moon"])
		store.next()
		expect(useHuntStore.getState().step).toBe(1)
	})

	it("keeps wrong guesses as words only, cleared by the answer", () => {
		const store = useHuntStore.getState()
		store.start("firstSteps")
		store.setGuess({ bodyId: "mars", kind: "other" })
		expect(useHuntStore.getState().guess?.bodyId).toBe("mars")
		store.solve("moon")
		expect(useHuntStore.getState().guess).toBeNull()
	})

	it("continues the hunt in progress and starts any other fresh", () => {
		const store = useHuntStore.getState()
		store.start("firstSteps")
		store.solve("moon")
		store.next()
		store.setOpen(false)
		store.resume("firstSteps")
		expect(useHuntStore.getState()).toMatchObject({ step: 1, open: true })
		store.resume("weirdWorlds")
		expect(useHuntStore.getState()).toMatchObject({
			key: "weirdWorlds",
			step: 0,
			found: [],
		})
	})

	it("browses the chooser without losing the hunt in progress", () => {
		const store = useHuntStore.getState()
		store.start("firstSteps")
		store.solve("moon")
		store.browse()
		expect(useHuntStore.getState()).toMatchObject({
			choosing: true,
			key: "firstSteps",
			found: ["moon"],
		})
		store.resume("firstSteps")
		expect(useHuntStore.getState()).toMatchObject({
			choosing: false,
			phase: "found",
		})
	})

	it("keeps the chooser's difficulty and the Easy assist out of the progress (#52)", () => {
		const store = useHuntStore.getState()
		store.setDifficulty("easy")
		store.setAssist(true)
		store.start("lookAndFind")
		expect(useHuntStore.getState()).toMatchObject({
			difficulty: "easy",
			assist: true,
		})
		const saved = JSON.parse(sessionStorage.getItem(HUNT_STORAGE_KEY)!)
		expect(Object.keys(saved).sort()).toEqual(
			["found", "hints", "key", "phase", "step"].sort(),
		)
	})

	it("keeps the progress in sessionStorage", () => {
		const store = useHuntStore.getState()
		store.start("moonSafari")
		store.solve("moon")
		expect(parseProgress(sessionStorage.getItem(HUNT_STORAGE_KEY))).toEqual({
			key: "moonSafari",
			step: 0,
			hints: 0,
			phase: "found",
			found: ["moon"],
		})
	})
})

describe("parseProgress", () => {
	it("rejects anything malformed", () => {
		expect(parseProgress(null)).toBeNull()
		expect(parseProgress("{")).toBeNull()
		expect(parseProgress("{}")).toBeNull()
		expect(
			parseProgress(
				JSON.stringify({
					key: "x",
					step: 1.5,
					hints: 0,
					phase: "asking",
					found: [],
				}),
			),
		).toBeNull()
		expect(
			parseProgress(
				JSON.stringify({
					key: "x",
					step: 0,
					hints: 0,
					phase: "won",
					found: [],
				}),
			),
		).toBeNull()
	})

	it("reads back what was written", () => {
		const progress = {
			key: "a.b",
			step: 2,
			hints: 1,
			phase: "asking" as const,
			found: ["moon", "mars"],
		}
		expect(parseProgress(JSON.stringify(progress))).toEqual(progress)
	})
})
