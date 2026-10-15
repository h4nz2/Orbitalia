import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useHudStore } from "@/store/hud"
import { usePresentationStore } from "@/store/presentation"
import { useSheetStore } from "@/store/sheet"
import { useTourStore } from "@/store/tour"

import { useIntroStore } from "../intro/intro"
import { useQuickLookStore } from "../quickLook/quickLook"
import {
	GESTURE_HINT_KEY,
	REST_MS,
	dismissGestureHint,
	gestureHintShown,
	mayShowGestureHint,
	resetGestureHintVisit,
	useGestureHintStore,
	watchGestureHint,
	type GestureHintContext,
} from "./gestureHint"

const showing = () => useGestureHintStore.getState().showing

let storage: Map<string, string> | null
/** The screen: a phone held upright with a finger, or not. */
let uprightTouch = true
let unwatch: () => void = () => undefined

/** A student's phone on a world's card, the scene drawn and at rest. */
const calm: GestureHintContext = {
	uprightTouch: true,
	presenting: false,
	hidden: false,
	opening: false,
	quickLook: false,
	sceneOn: true,
	world: true,
	moving: false,
}

/** The scene drawn, a world's card in the sheet. */
const arrive = () => {
	useHudStore.setState({ sceneOn: true })
	useSheetStore.setState({ world: true })
}

beforeEach(() => {
	vi.useFakeTimers()
	storage = new Map()
	uprightTouch = true
	vi.stubGlobal("window", {
		get localStorage(): Storage {
			if (storage === null) throw new Error("blocked")
			return {
				getItem: (key: string) => storage?.get(key) ?? null,
				setItem: (key: string, value: string) => storage?.set(key, value),
			} as Storage
		},
		matchMedia: () => ({ matches: uprightTouch }),
	})
	resetGestureHintVisit()
	unwatch = watchGestureHint()
})

afterEach(() => {
	unwatch()
	vi.useRealTimers()
	vi.unstubAllGlobals()
	useHudStore.setState(useHudStore.getInitialState(), true)
	useSheetStore.setState(useSheetStore.getInitialState(), true)
	usePresentationStore.setState(usePresentationStore.getInitialState(), true)
	useIntroStore.setState(useIntroStore.getInitialState(), true)
	useQuickLookStore.setState(useQuickLookStore.getInitialState(), true)
	useTourStore.setState(useTourStore.getInitialState(), true)
	useGestureHintStore.setState(useGestureHintStore.getInitialState(), true)
})

describe("the gesture hint (#62)", () => {
	it("may show on an upright phone with a finger, on a world's card, at rest", () => {
		expect(mayShowGestureHint(calm)).toBe(true)
		for (const [key, value] of [
			["uprightTouch", false],
			["presenting", true],
			["hidden", true],
			["opening", true],
			["quickLook", true],
			["sceneOn", false],
			["world", false],
			["moving", true],
		] as const)
			expect(mayShowGestureHint({ ...calm, [key]: value }), key).toBe(false)
	})

	it("appears once the scene has been at rest for a while, and is remembered", () => {
		arrive()
		vi.advanceTimersByTime(REST_MS - 1)
		expect(showing()).toBe(false)
		vi.advanceTimersByTime(1)
		expect(showing()).toBe(true)
		expect(storage?.get(GESTURE_HINT_KEY)).toBe("1")
		dismissGestureHint()
		expect(showing()).toBe(false)
		// never again on this device
		expect(gestureHintShown()).toBe(true)
		useHudStore.setState({ cameraMoving: true })
		useHudStore.setState({ cameraMoving: false })
		vi.advanceTimersByTime(REST_MS * 2)
		expect(showing()).toBe(false)
	})

	it("waits while the camera moves: every move starts the wait again", () => {
		arrive()
		vi.advanceTimersByTime(REST_MS / 2)
		useHudStore.setState({ cameraMoving: true })
		vi.advanceTimersByTime(REST_MS)
		expect(showing()).toBe(false)
		useHudStore.setState({ cameraMoving: false })
		vi.advanceTimersByTime(REST_MS - 1)
		expect(showing()).toBe(false)
		vi.advanceTimersByTime(1)
		expect(showing()).toBe(true)
	})

	it("never on a laptop, a tablet or a phone on its side", () => {
		uprightTouch = false
		arrive()
		vi.advanceTimersByTime(REST_MS * 3)
		expect(showing()).toBe(false)
		expect(storage?.has(GESTURE_HINT_KEY)).toBe(false)
	})

	it("waits for a world's card: not over a tour, a hunt or a panel", () => {
		useHudStore.setState({ sceneOn: true })
		vi.advanceTimersByTime(REST_MS * 3)
		expect(showing()).toBe(false)
		useSheetStore.setState({ world: true })
		vi.advanceTimersByTime(REST_MS)
		expect(showing()).toBe(true)
	})

	it("after the opening, its hints and the quick look, never during them", () => {
		useIntroStore.setState({ status: "playing" })
		arrive()
		vi.advanceTimersByTime(REST_MS * 2)
		useIntroStore.setState({ status: "handover", hints: true })
		useQuickLookStore.setState({ asking: true })
		vi.advanceTimersByTime(REST_MS * 2)
		useIntroStore.setState({ hints: false })
		vi.advanceTimersByTime(REST_MS * 2)
		expect(showing()).toBe(false)
		useQuickLookStore.setState({ asking: false })
		vi.advanceTimersByTime(REST_MS)
		expect(showing()).toBe(true)
	})

	it("never while presenting, and it goes when presenting starts, the controls hide, the card makes way or the sheet is dragged", () => {
		usePresentationStore.setState({ presenting: true })
		arrive()
		vi.advanceTimersByTime(REST_MS * 2)
		expect(showing()).toBe(false)
		expect(storage?.has(GESTURE_HINT_KEY)).toBe(false)

		for (const away of [
			() => usePresentationStore.setState({ presenting: true }),
			() => usePresentationStore.setState({ chromeHidden: true }),
			() => useSheetStore.setState({ world: false }),
			() => useSheetStore.setState({ dragging: true }),
		]) {
			usePresentationStore.setState({ presenting: false, chromeHidden: false })
			useSheetStore.setState({ world: true, dragging: false })
			useGestureHintStore.setState({ showing: true })
			away()
			expect(showing()).toBe(false)
		}
	})

	it("with storage blocked, at most once per visit", () => {
		storage = null
		arrive()
		vi.advanceTimersByTime(REST_MS)
		expect(showing()).toBe(true)
		dismissGestureHint()
		useSheetStore.setState({ world: false })
		useSheetStore.setState({ world: true })
		vi.advanceTimersByTime(REST_MS * 2)
		expect(showing()).toBe(false)
	})
})
