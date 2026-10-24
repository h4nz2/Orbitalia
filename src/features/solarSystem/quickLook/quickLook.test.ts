import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { tourFiles } from "@/data/tours"
import { LOCALES, READING_LEVELS, createI18n, type MessageKey } from "@/i18n"
import { useHudStore } from "@/store/hud"
import { useLightStore } from "@/store/light"
import { usePresentationStore } from "@/store/presentation"
import { useScaleStore } from "@/store/scale"
import { useSimStore } from "@/store/sim"
import { useSpacecraftStore } from "@/store/spacecraft"
import { useTourStore } from "@/store/tour"

import { useIntroStore } from "../intro/intro"
import { nextStop } from "../tours/player"
import {
	ASK_TIMEOUT_MS,
	QUICK_LOOK_ASKED_KEY,
	answer,
	ask,
	hasBeenAsked,
	leaveQuickLook,
	mayAsk,
	resetVisit,
	startQuickLook,
	useQuickLookStore,
	watchQuickLook,
} from "./quickLook"
import { QUICK_LOOK_ID, QUICK_LOOK_STEPS, quickLookTour } from "./script"

const sim = () => useSimStore.getState()
const tour = () => useTourStore.getState()
const look = () => useQuickLookStore.getState()

let storage: Map<string, string> | null
let unwatch: () => void = () => undefined

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
	resetVisit()
	unwatch = watchQuickLook()
})

afterEach(() => {
	unwatch()
	vi.useRealTimers()
	vi.unstubAllGlobals()
	useSimStore.setState(useSimStore.getInitialState(), true)
	useScaleStore.setState(useScaleStore.getInitialState(), true)
	useTourStore.setState(useTourStore.getInitialState(), true)
	useIntroStore.setState(useIntroStore.getInitialState(), true)
	useLightStore.setState(useLightStore.getInitialState(), true)
	useHudStore.setState(useHudStore.getInitialState(), true)
	useQuickLookStore.setState(useQuickLookStore.getInitialState(), true)
	usePresentationStore.setState(usePresentationStore.getInitialState(), true)
	useSpacecraftStore.setState(useSpacecraftStore.getInitialState(), true)
})

/** Lets the watcher's microtasks run. */
const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve))

describe("the script (src/data/quickLook.json)", () => {
	it("has five features, a step for teachers and one for the help page", () => {
		expect(QUICK_LOOK_STEPS.map((step) => step.id)).toEqual([
			"fly",
			"trueScale",
			"time",
			"compare",
			"light",
			"teachers",
			"more",
		])
		expect(QUICK_LOOK_STEPS.at(-2)?.spot).toBe("present")
		expect(QUICK_LOOK_STEPS.at(-1)?.spot).toBe("help")
	})

	it("is a tour the player can play, which is never a menu tour", () => {
		const played = quickLookTour()
		expect(played.id).toBe(QUICK_LOOK_ID)
		expect(played.returnOnExit).toBe(true)
		expect(played.stops).toHaveLength(QUICK_LOOK_STEPS.length)
		for (const stop of played.stops) {
			expect(stop).not.toHaveProperty("spot")
			expect(stop).not.toHaveProperty("flash")
			expect(stop).not.toHaveProperty("compare")
		}
		expect(
			Object.keys(tourFiles).some((path) => path.includes(QUICK_LOOK_ID)),
		).toBe(false)
	})

	it("takes about a minute when it moves on by itself", () => {
		// every step but the last waits its autoSeconds after arriving; moves take a few seconds each
		const waits = QUICK_LOOK_STEPS.slice(0, -1).reduce(
			(total, step) => total + (step.autoSeconds ?? 0),
			0,
		)
		expect(waits).toBeGreaterThanOrEqual(45)
		expect(waits + 3 * QUICK_LOOK_STEPS.length).toBeLessThanOrEqual(90)
	})

	it("has its words in every locale and reading level", () => {
		for (const locale of LOCALES)
			for (const readingLevel of READING_LEVELS) {
				const { t } = createI18n({ locale, readingLevel })
				for (const step of QUICK_LOOK_STEPS)
					for (const part of ["title", "text"])
						expect(
							t(`solarSystem.quickLook.steps.${step.id}.${part}` as MessageKey),
							`${locale} ${readingLevel} ${step.id}.${part}`,
						).not.toMatch(/^solarSystem\./)
				expect(t("solarSystem.quickLook.ask.title")).not.toMatch(
					/^solarSystem\./,
				)
			}
	})
})

describe("the question", () => {
	it("follows the first visit's opening, once per browser", () => {
		expect(mayAsk()).toBe(true)
		useIntroStore.setState({ status: "playing" })
		useIntroStore.setState({ status: "handover" })
		expect(look().asking).toBe(true)
		expect(storage?.get(QUICK_LOOK_ASKED_KEY)).toBe("1")
		answer(false)
		expect(look().asking).toBe(false)
		expect(tour().tour).toBeNull()

		// the next visit: remembered in the browser
		resetVisit()
		expect(hasBeenAsked()).toBe(true)
		useIntroStore.setState({ status: "playing" })
		useIntroStore.setState({ status: "handover" })
		expect(look().asking).toBe(false)
	})

	it("is asked at most once per visit when the browser refuses storage", () => {
		storage = null
		expect(ask()).toBe(true)
		answer(false)
		expect(ask()).toBe(false)
		resetVisit()
		expect(ask()).toBe(true)
	})

	it("is never asked in presentation mode or over another tour", () => {
		usePresentationStore.getState().setPresenting(true)
		expect(ask()).toBe(false)
		usePresentationStore.getState().setPresenting(false)
		startQuickLook()
		expect(ask()).toBe(false)
	})

	it("goes away by itself: no answer is no, and it is not asked again", () => {
		vi.useFakeTimers()
		expect(ask()).toBe(true)
		vi.advanceTimersByTime(ASK_TIMEOUT_MS + 1)
		expect(look().asking).toBe(false)
		expect(tour().tour).toBeNull()
		expect(ask()).toBe(false)
	})
})

describe("the quick look", () => {
	it("yes plays it from the first step, moving on by itself", () => {
		useHudStore.getState().setPanel("layers")
		ask()
		answer(true)
		expect(tour().tour?.id).toBe(QUICK_LOOK_ID)
		expect(tour().index).toBe(0)
		expect(tour().auto).toBe(true)
		expect(look().spot).toBe("picker")
		// the dock's panel made way for its card
		expect(useHudStore.getState().panel).toBeNull()
	})

	it("shows each feature working: the scale, the time, the flash", () => {
		startQuickLook()
		nextStop()
		expect(look().spot).toBe("scale")
		expect(useScaleStore.getState().targetId).toBe("trueScale")
		nextStop()
		expect(look().spot).toBe("time")
		expect(useScaleStore.getState().targetId).toBe("everythingVisible")
		expect(sim().timeWarp).toBeGreaterThan(86400 * 20)
		nextStop()
		expect(look().spot).toBe("compare")
		expect(useLightStore.getState().pulse).toBeNull()
		nextStop()
		expect(look().spot).toBe("tools")
		expect(useLightStore.getState().pulse?.emitterId).toBe("sun")
		nextStop()
		expect(look().spot).toBe("present")
		// it shows presentation mode, it does not switch the room into it
		expect(usePresentationStore.getState().presenting).toBe(false)
		expect(useLightStore.getState().pulse).toBeNull()
		nextStop()
		expect(look().spot).toBe("help")
	})

	it("finishing goes back to a calm view: the overview, now, 1x, everything visible", () => {
		const before = sim().view
		startQuickLook()
		nextStop()
		nextStop()
		nextStop()
		nextStop() // the flash
		leaveQuickLook()
		expect(tour().tour).toBeNull()
		expect(look().spot).toBeNull()
		expect(useLightStore.getState().pulse).toBeNull()
		expect(useScaleStore.getState().targetId).toBe("everythingVisible")
		expect(sim().timeWarp).toBe(1)
		expect(sim().paused).toBe(false)
		expect(sim().transition?.view ?? sim().view).toEqual(before)
	})

	it("Escape (the way out) ends it, calm", async () => {
		startQuickLook()
		nextStop()
		sim().reset()
		await flush()
		expect(tour().tour).toBeNull()
		expect(look().spot).toBeNull()
		expect(useScaleStore.getState().targetId).toBe("everythingVisible")
	})

	it("a world clicked mid-way ends it there, with the speed and scale calm again", async () => {
		startQuickLook()
		nextStop()
		nextStop() // a month per second, at the overview
		sim().setFocus("jupiter")
		await flush()
		expect(tour().tour).toBeNull()
		expect(sim().focusId).toBe("jupiter")
		expect(sim().timeWarp).toBe(1)
		expect(useScaleStore.getState().targetId).toBe("everythingVisible")
	})

	it("a world clicked mid-way puts the spacecraft layer back as it was (#70)", async () => {
		startQuickLook()
		nextStop()
		useSpacecraftStore.getState().setShowSpacecraft(true)
		sim().setFocus("jupiter")
		await flush()
		expect(tour().tour).toBeNull()
		expect(useSpacecraftStore.getState().showSpacecraft).toBe(false)
	})

	it("a spacecraft picked mid-way stays drawn when it ends there", async () => {
		startQuickLook()
		nextStop()
		// what the list's pick does: choose it, fly to it
		useSpacecraftStore.getState().selectCraft("voyager1")
		sim().goTo({ kind: "point", anchorId: "jupiter", offsetKm: [1e6, 0, 0] })
		await flush()
		expect(tour().tour).toBeNull()
		expect(useSpacecraftStore.getState().showSpacecraft).toBe(true)
		expect(useSpacecraftStore.getState().selectedCraftId).toBe("voyager1")
	})
})
