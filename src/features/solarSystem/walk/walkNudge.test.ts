import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { usePresentationStore } from "@/store/presentation"
import { useScaleStore } from "@/store/scale"
import { useTourStore } from "@/store/tour"

import { startTour } from "../tours/player"
import {
	NUDGE_TIMEOUT_MS,
	WALK_NUDGE_KEY,
	dismissWalkNudge,
	mayNudge,
	nudgeShown,
	nudgeTowardsWalk,
	resetNudgeVisit,
	useWalkNudgeStore,
	watchWalkNudge,
} from "./walkNudge"

const showing = () => useWalkNudgeStore.getState().showing

let storage: Map<string, string> | null
let unwatch: () => void = () => undefined

/** The viewer switches the scale (the store's switch, then the nudge's turn). */
const choose = (id: Parameters<typeof nudgeTowardsWalk>[0]) => {
	useScaleStore.getState().switchTo(id, 0, 0)
	return nudgeTowardsWalk(id)
}

beforeEach(() => {
	storage = new Map()
	vi.stubGlobal("window", {
		get localStorage(): Storage {
			if (storage === null) throw new Error("blocked")
			return {
				getItem: (key: string) => storage?.get(key) ?? null,
				setItem: (key: string, value: string) => storage?.set(key, value),
			} as Storage
		},
		matchMedia: () => ({ matches: false }),
	})
	resetNudgeVisit()
	unwatch = watchWalkNudge()
})

afterEach(() => {
	unwatch()
	vi.useRealTimers()
	vi.unstubAllGlobals()
	useScaleStore.setState(useScaleStore.getInitialState(), true)
	useTourStore.setState(useTourStore.getInitialState(), true)
	usePresentationStore.setState(usePresentationStore.getInitialState(), true)
	useWalkNudgeStore.setState(useWalkNudgeStore.getInitialState(), true)
})

describe("the walk's nudge (#48)", () => {
	it("shows on the viewer's first switch to True scale, and only for True scale", () => {
		expect(choose("textbook")).toBe(false)
		expect(showing()).toBe(false)
		expect(choose("trueScale")).toBe(true)
		expect(showing()).toBe(true)
		expect(storage?.get(WALK_NUDGE_KEY)).toBe("1")
	})

	it("shows once: not again in this visit, nor on the next one", () => {
		choose("trueScale")
		dismissWalkNudge()
		choose("everythingVisible")
		expect(choose("trueScale")).toBe(false)
		expect(showing()).toBe(false)
		// the next visit reads the browser's memory
		resetNudgeVisit()
		expect(nudgeShown()).toBe(true)
		expect(choose("everythingVisible")).toBe(false)
		expect(choose("trueScale")).toBe(false)
	})

	it("with storage blocked, shows at most once per visit", () => {
		storage = null
		expect(choose("trueScale")).toBe(true)
		dismissWalkNudge()
		choose("textbook")
		expect(choose("trueScale")).toBe(false)
	})

	it("stays quiet in presentation mode, and keeps its one showing for later", () => {
		usePresentationStore.getState().setPresenting(true)
		expect(mayNudge()).toBe(false)
		expect(choose("trueScale")).toBe(false)
		expect(storage?.has(WALK_NUDGE_KEY)).toBe(false)
		usePresentationStore.getState().setPresenting(false)
		choose("everythingVisible")
		expect(choose("trueScale")).toBe(true)
	})

	it("stays quiet while a tour talks in the dock", () => {
		startTour("howBig")
		expect(choose("trueScale")).toBe(false)
		expect(showing()).toBe(false)
	})

	it("goes away when the scale leaves True scale, when presenting starts, and after a while", () => {
		vi.useFakeTimers()
		choose("trueScale")
		choose("textbook")
		expect(showing()).toBe(false)

		resetNudgeVisit()
		storage = new Map()
		choose("trueScale")
		usePresentationStore.getState().setPresenting(true)
		expect(showing()).toBe(false)
		usePresentationStore.getState().setPresenting(false)

		resetNudgeVisit()
		storage = new Map()
		choose("everythingVisible")
		choose("trueScale")
		expect(showing()).toBe(true)
		vi.advanceTimersByTime(NUDGE_TIMEOUT_MS - 1)
		expect(showing()).toBe(true)
		vi.advanceTimersByTime(1)
		expect(showing()).toBe(false)
	})

	it("goes with the page", () => {
		choose("trueScale")
		unwatch()
		expect(showing()).toBe(false)
	})
})
