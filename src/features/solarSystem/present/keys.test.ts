import { afterEach, describe, expect, it } from "vitest"

import { planets } from "@/data"
import { useSimStore } from "@/store/sim"

import {
	SCALE_CYCLE,
	keyCommand,
	nextScalePreset,
	presenterStep,
	viewBodyOfKey,
} from "./keys"

const press = (
	key: string,
	modifiers: Partial<Record<"ctrlKey" | "metaKey" | "altKey", boolean>> = {},
) =>
	keyCommand({
		key,
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		...modifiers,
	})

const store = () => useSimStore.getState()
afterEach(() => useSimStore.setState(useSimStore.getInitialState(), true))

describe("keyCommand", () => {
	it("maps a presenter remote's PageDown / PageUp to next / previous", () => {
		expect(press("PageDown")).toEqual({ kind: "step", direction: 1 })
		expect(press("PageUp")).toEqual({ kind: "step", direction: -1 })
	})

	it("maps 0 to the whole system and 1..8 to the planets; 9 is free", () => {
		expect(press("0")).toEqual({ kind: "view", index: 0 })
		expect(press("3")).toEqual({ kind: "view", index: 3 })
		expect(press("8")).toEqual({ kind: "view", index: 8 })
		expect(press("9")).toBeNull()
	})

	it("maps the letters in either case, Home and ?", () => {
		expect(press("h")).toEqual({ kind: "chrome" })
		expect(press("H")).toEqual({ kind: "chrome" })
		expect(press("f")).toEqual({ kind: "fullscreen" })
		expect(press("p")).toEqual({ kind: "present" })
		expect(press("c")).toEqual({ kind: "contrast" })
		expect(press("x")).toEqual({ kind: "stopLight" })
		expect(press("X")).toEqual({ kind: "stopLight" })
		expect(press("s")).toEqual({ kind: "scale" })
		expect(press("l")).toEqual({ kind: "labels" })
		expect(press("r")).toEqual({ kind: "start" })
		expect(press("Home")).toEqual({ kind: "start" })
		expect(press("?")).toEqual({ kind: "help" })
	})

	it("maps Backspace to Back (#46), never with a modifier", () => {
		expect(press("Backspace")).toEqual({ kind: "back" })
		expect(press("Backspace", { altKey: true })).toBeNull()
		expect(press("Backspace", { ctrlKey: true })).toBeNull()
	})

	it("never takes a browser shortcut or a key the HUD already owns", () => {
		expect(press("r", { ctrlKey: true })).toBeNull()
		expect(press("f", { metaKey: true })).toBeNull()
		expect(press("3", { altKey: true })).toBeNull()
		for (const key of [
			" ",
			"+",
			"-",
			"ArrowLeft",
			"ArrowRight",
			"Escape",
			"q",
			"F5",
		]) {
			expect(press(key)).toBeNull()
		}
	})
})

describe("viewBodyOfKey", () => {
	it("counts the planets from the Sun: 3 is Earth", () => {
		expect(viewBodyOfKey(0)).toBeNull()
		expect(viewBodyOfKey(1)).toBe("mercury")
		expect(viewBodyOfKey(3)).toBe("earth")
		expect(viewBodyOfKey(8)).toBe("neptune")
		expect(planets).toHaveLength(8)
	})
})

describe("nextScalePreset", () => {
	it("cycles Everything visible, Textbook, True scale and round again", () => {
		expect(nextScalePreset("everythingVisible")).toBe("textbook")
		expect(nextScalePreset("textbook")).toBe("trueScale")
		expect(nextScalePreset("trueScale")).toBe("everythingVisible")
		expect(nextScalePreset("bigPlanets")).toBe(SCALE_CYCLE[0])
		expect(nextScalePreset(null)).toBe(SCALE_CYCLE[0])
	})
})

describe("presenterStep", () => {
	it("cycles the Sun and the planets like Left / Right when no tour runs", () => {
		expect(presenterStep(1)).toBe("mercury")
		store().setFocus("earth")
		expect(presenterStep(1)).toBe("mars")
		expect(presenterStep(-1)).toBe("venus")
		store().setFocus("neptune")
		expect(presenterStep(1)).toBe("sun")
	})

	it("steps a tour instead (#28's seam): next, back, and resume after an interruption", () => {
		store().playSequence([
			{ view: { kind: "body", id: "earth" } },
			{ view: { kind: "body", id: "mars" } },
			{ view: { kind: "body", id: "jupiter" } },
		])
		expect(presenterStep(1)).toBeNull()
		expect(store().sequence?.index).toBe(1)
		expect(presenterStep(1)).toBeNull()
		expect(store().sequence?.index).toBe(2)
		expect(presenterStep(-1)).toBeNull()
		expect(store().sequence?.index).toBe(1)
		expect(store().view).toEqual({ kind: "body", id: "mars" })

		store().goTo({ kind: "body", id: "saturn" })
		expect(store().sequence?.phase).toBe("interrupted")
		presenterStep(1)
		expect(store().sequence?.phase).toBe("moving")
		expect(store().view).toEqual({ kind: "body", id: "mars" })
	})
})
